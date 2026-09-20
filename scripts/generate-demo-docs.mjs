// Generates the fictional "Maya Patel" H-1B case documents used by the sample matter.
// Output: demo-documents/ (for drag-and-drop) and public/demo-documents/ (served by the app).
//
// Every document is fictional. Names, employers, addresses, identifiers and the law firm
// (Sharma LLP / Daksh Sharma) are invented for the sample case; none of it describes a real
// person, company, firm or licensed attorney. The documents are laid out the way the real
// paperwork is laid out — a CEAC application printout, a one-page resume, a letter on
// company letterhead, a firm worksheet, a lease — so the pipeline is exercised on realistic
// input rather than on text written for the analyzer.
//
// The rule-based demo engine (src/lib/demo/analysis.ts) locates specific phrases in the
// extracted text of these files; keep the field labels and sentences it quotes intact.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Footer,
  Header,
  PageNumber,
} from "docx";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDirs = [path.join(root, "demo-documents"), path.join(root, "public", "demo-documents")];
for (const d of outDirs) fs.mkdirSync(d, { recursive: true });

// ---------- the firm ----------
const FIRM = {
  name: "Sharma LLP",
  practice: "Immigration & Nationality Law",
  attorney: "Daksh Sharma",
  address1: "1230 Peachtree Street NE, Suite 1900",
  address2: "Atlanta, Georgia 30309",
  phone: "(404) 555-0198",
  email: "intake@sharmallp.example",
  matter: "SL-2024-0417",
};

// ---------- fonts ----------
// Real documents are not set in Helvetica. Use the system's Georgia / Times New Roman / Arial when
// available (macOS ships them) and fall back to PDFKit's built-in fonts elsewhere.
const FONT_DIRS = ["/System/Library/Fonts/Supplemental", "/Library/Fonts", "C:/Windows/Fonts"];
function systemFont(file) {
  for (const d of FONT_DIRS) {
    const p = path.join(d, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function registerFonts(doc) {
  const reg = (name, file, fallback) => {
    const p = systemFont(file);
    if (p) {
      doc.registerFont(name, p);
      return name;
    }
    return fallback;
  };
  return {
    serif: reg("Georgia", "Georgia.ttf", "Times-Roman"),
    serifBold: reg("Georgia-Bold", "Georgia Bold.ttf", "Times-Bold"),
    serifItalic: reg("Georgia-Italic", "Georgia Italic.ttf", "Times-Italic"),
    times: reg("TNR", "Times New Roman.ttf", "Times-Roman"),
    timesBold: reg("TNR-Bold", "Times New Roman Bold.ttf", "Times-Bold"),
    timesItalic: reg("TNR-Italic", "Times New Roman Italic.ttf", "Times-Italic"),
    sans: reg("Arial", "Arial.ttf", "Helvetica"),
    sansBold: reg("Arial-Bold", "Arial Bold.ttf", "Helvetica-Bold"),
    sansItalic: reg("Arial-Italic", "Arial Italic.ttf", "Helvetica-Oblique"),
    script: reg("Script", "Brush Script.ttf", "Times-Italic"),
  };
}

const LETTER = { width: 612, height: 792 };
const M = 64; // page margin

function writePdf(fileName, meta, build, subdir = "") {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      bufferPages: true,
      margins: { top: M, bottom: M, left: M, right: M },
      info: { Title: meta.title, Author: meta.author, Subject: meta.subject ?? meta.title, Creator: meta.creator ?? "Microsoft Word" },
    });
    const dir = path.join(outDirs[0], subdir);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, fileName);
    const stream = fs.createWriteStream(target);
    doc.pipe(stream);
    build(doc, registerFonts(doc));
    doc.end();
    stream.on("finish", () => {
      for (const d of outDirs.slice(1)) {
        const dd = path.join(d, subdir);
        fs.mkdirSync(dd, { recursive: true });
        fs.copyFileSync(target, path.join(dd, fileName));
      }
      resolve();
    });
    stream.on("error", reject);
  });
}

const contentW = LETTER.width - 2 * M;

/** Left text and right-aligned text on the same baseline (company / location, title / dates). */
function lineLR(doc, left, right, { font, rightFont, size = 10.5, color = "#111", rightColor, gap = 2 }) {
  const y = doc.y;
  doc.font(font).fontSize(size).fillColor(color).text(left, M, y, { width: contentW - 160, lineBreak: false });
  doc.font(rightFont ?? font).fontSize(size).fillColor(rightColor ?? color).text(right, M, y, { width: contentW, align: "right", lineBreak: false });
  doc.y = y + doc.currentLineHeight() + gap;
  doc.x = M;
}

function rule(doc, { color = "#999", width = 0.5, y = doc.y, inset = 0 } = {}) {
  doc.moveTo(M + inset, y).lineTo(LETTER.width - M - inset, y).strokeColor(color).lineWidth(width).stroke();
}

/** Footer on every buffered page, with "Page x of y" on the right. */
function pageFooters(doc, font, leftText) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = LETTER.height - 38;
    doc.font(font).fontSize(7.5).fillColor("#666");
    if (leftText) doc.text(leftText, M, y, { width: contentW - 100, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M, y, { width: contentW, align: "right", lineBreak: false });
    doc.page.margins.bottom = saved;
  }
}

/** A Code-128-looking barcode (visual only). */
function barcode(doc, x, y, w, h, seed) {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  let cx = x;
  doc.save();
  while (cx < x + w) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const bar = 0.7 + ((s >>> 16) % 4) * 0.55;
    if (((s >>> 8) & 3) !== 0) doc.rect(cx, y, bar, h).fill("#111");
    cx += bar + 0.9 + ((s >>> 12) % 3) * 0.5;
  }
  doc.restore();
}

// =====================================================================================
// 1. DS-160 — Consular Electronic Application Center printout
// =====================================================================================
await writePdf(
  "DS-160_Application_Summary_Maya_Patel.pdf",
  { title: "DS-160 Online Nonimmigrant Visa Application", author: "Consular Electronic Application Center", creator: "CEAC" },
  (doc, F) => {
    const navy = "#1f3864";
    // Header band: seal, department, system name
    doc.save();
    doc.circle(M + 18, M + 16, 16).lineWidth(1.2).strokeColor(navy).stroke();
    doc.circle(M + 18, M + 16, 11).lineWidth(0.6).strokeColor(navy).stroke();
    doc.font(F.sansBold).fontSize(5).fillColor(navy).text("DEPT OF STATE", M + 2, M + 13.5, { width: 32, align: "center", lineBreak: false });
    doc.restore();
    doc.font(F.sansBold).fontSize(12.5).fillColor(navy).text("U.S. DEPARTMENT OF STATE", M + 44, M + 3, { lineBreak: false });
    doc.font(F.sans).fontSize(9).fillColor("#333").text("Consular Electronic Application Center", M + 44, M + 19, { lineBreak: false });
    doc.font(F.sans).fontSize(8).fillColor("#555").text("ceac.state.gov", M, M + 3, { width: contentW, align: "right", lineBreak: false });
    doc.y = M + 40;
    rule(doc, { color: navy, width: 1.5 });
    doc.y += 12;

    doc.font(F.sansBold).fontSize(15).fillColor("#111").text("Online Nonimmigrant Visa Application (DS-160)", M, doc.y);
    doc.font(F.sans).fontSize(10.5).fillColor("#333").text("Application Summary — Print for your records", M, doc.y + 2);
    doc.y += 10;

    // Meta strip with barcode
    const stripY = doc.y;
    doc.rect(M, stripY, contentW, 58).fill("#f3f5f9");
    doc.fillColor("#111");
    const meta = [
      ["Application ID", "AA00D7K2ML"],
      ["Location", "INDIA, MUMBAI"],
      ["Visa Class", "H-1B"],
      ["Petition Receipt", "WAC2490312345"],
      ["Submitted", "03-JUN-2024"],
      ["Interview", "Not yet scheduled"],
    ];
    meta.forEach(([k, v], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = M + 10 + col * 178;
      const y = stripY + 8 + row * 16;
      doc.font(F.sans).fontSize(7.5).fillColor("#555").text(k.toUpperCase(), x, y, { width: 72, lineBreak: false });
      doc.font(F.sansBold).fontSize(9).fillColor("#111").text(v, x + 74, y - 1, { width: 100, lineBreak: false });
    });
    barcode(doc, M + contentW - 112, stripY + 8, 102, 32, "AA00D7K2ML");
    doc.font(F.sans).fontSize(7).fillColor("#333").text("AA00D7K2ML", M + contentW - 112, stripY + 43, { width: 102, align: "center", lineBreak: false });
    doc.y = stripY + 70;
    doc.x = M;

    const section = (title) => {
      if (doc.y > LETTER.height - M - 60) doc.addPage();
      doc.y += 6;
      doc.rect(M, doc.y, contentW, 17).fill(navy);
      doc.font(F.sansBold).fontSize(9).fillColor("#fff").text(title, M + 8, doc.y + 4.5, { lineBreak: false });
      doc.y += 22;
      doc.x = M;
    };
    const rows = (pairs) => {
      const labelW = 210;
      for (const [k, v] of pairs) {
        if (doc.y > LETTER.height - M - 30) doc.addPage();
        const y = doc.y;
        doc.font(F.sans).fontSize(9).fillColor("#444").text(k, M + 8, y, { width: labelW - 12 });
        const yl = doc.y;
        doc.font(F.sans).fontSize(9.5).fillColor("#111").text(v, M + labelW, y, { width: contentW - labelW - 8 });
        doc.y = Math.max(doc.y, yl) + 3;
        rule(doc, { color: "#e1e4ea", width: 0.5 });
        doc.y += 3;
      }
      doc.x = M;
    };
    const grid = (headers, data, widths) => {
      const rowH = 18;
      let y = doc.y + 2;
      const draw = (cells, head) => {
        if (y + rowH > LETTER.height - M) {
          doc.addPage();
          y = M;
        }
        if (head) doc.rect(M, y, contentW, rowH).fill("#e8ecf3");
        let x = M;
        cells.forEach((c, i) => {
          doc.font(head ? F.sansBold : F.sans).fontSize(8.5).fillColor("#111").text(String(c), x + 6, y + 5, { width: widths[i] - 10, lineBreak: false });
          x += widths[i];
        });
        doc.moveTo(M, y + rowH).lineTo(M + contentW, y + rowH).strokeColor("#cfd4de").lineWidth(0.5).stroke();
        y += rowH;
      };
      draw(headers, true);
      data.forEach((r) => draw(r, false));
      doc.y = y + 6;
      doc.x = M;
    };

    section("Personal Information 1");
    rows([
      ["Surnames", "PATEL"],
      ["Given Names", "MAYA"],
      ["Full Name in Native Alphabet", "Does Not Apply/Technology Not Available"],
      ["Have you ever used other names?", "No"],
      ["Sex", "Female"],
      ["Marital Status", "Single"],
      ["Date of Birth", "April 12, 1996"],
      ["Place of Birth", "Ahmedabad, Gujarat, India"],
    ]);

    section("Personal Information 2");
    rows([
      ["Country/Region of Origin (Nationality)", "India"],
      ["Do you hold or have you held any nationality other than the one indicated above?", "No"],
      ["National Identification Number", "Does Not Apply"],
      ["U.S. Social Security Number", "Does Not Apply"],
    ]);

    section("Passport Information");
    rows([
      ["Passport/Travel Document Type", "Regular"],
      ["Passport Number", "Z7261904"],
      ["Country/Authority that Issued Passport", "India"],
      ["Issuance Date", "September 3, 2019"],
      ["Expiration Date", "September 2, 2029"],
      ["Have you ever lost a passport or had one stolen?", "No"],
    ]);

    section("Present Work / Education / Training");
    rows([
      ["Primary Occupation", "Computer Science"],
      ["Present Employer", "Northstar Systems LLC"],
      ["Employer Address", "1180 Peachtree Street NE, Suite 2400, Atlanta, GA 30309, United States"],
      ["Employer Telephone", "+1 (404) 555-0170"],
      ["Job Title", "Software Engineer"],
      ["Employment Start Date", "March 1, 2024"],
      ["Monthly Income (USD)", "11,000"],
      ["Duties", "Design and implement backend services for a logistics analytics platform; maintain data pipelines; participate in code review."],
    ]);

    section("Previous Work / Education / Training");
    rows([
      ["Were you previously employed?", "Yes"],
      ["Employer Name", "Cobalt Analytics Inc."],
      ["Employer Address", "500 West 2nd Street, Austin, TX 78701, United States"],
      ["Job Title", "Data Engineer"],
      ["Supervisor", "Priya Raman"],
      ["Employment Dates", "August 16, 2021 – December 22, 2023"],
      ["Have you attended any educational institutions at a secondary level or above?", "Yes"],
      ["Institution Attended", "The University of Texas at Austin — M.S., Computer Science (August 2019 – May 2021)"],
    ]);

    section("Address History (Last Five Years)");
    grid(
      ["Street Address", "City, State, ZIP", "From", "To"],
      [
        ["88 Peachtree Walk NE, Apt 12B", "Atlanta, GA 30308", "May 1, 2024", "Present"],
        ["2140 Lakeview Drive, Apt 7", "Austin, TX 78703", "August 15, 2021", "December 31, 2023"],
        ["2400 Nueces Street, Unit 301", "Austin, TX 78705", "August 1, 2019", "August 14, 2021"],
      ],
      [190, 130, 82, 82],
    );

    section("Previous U.S. Travel");
    rows([
      ["Have you ever been in the U.S.?", "Yes"],
      ["Most Recent Arrival", "January 8, 2024 — Hartsfield–Jackson Atlanta International Airport"],
      ["Length of Stay", "Ongoing (F-1 OPT status through completion of change of status)"],
      ["Have you ever been issued a U.S. visa?", "Yes"],
      ["Previous U.S. Visa", "F-1, issued July 22, 2019, U.S. Consulate General Mumbai"],
      ["Have you ever been refused a U.S. visa, been refused admission, or withdrawn an application?", "No"],
    ]);

    section("Travel Information — Countries Visited in the Last Five Years");
    rows([
      ["Have you traveled to any countries/regions within the last five years?", "Yes"],
      ["Country/Region 1", "Canada"],
      ["Country/Region 2", "India"],
    ]);

    section("Sign and Submit");
    rows([
      ["Did anyone assist you in filling out this application?", "No"],
      ["Electronic Signature", "MAYA PATEL"],
      ["Date Signed", "03-JUN-2024"],
    ]);
    doc.y += 4;
    doc.font(F.sans).fontSize(8.5).fillColor("#333").text(
      "I certify that I have read and understood all the questions set forth in this application and that the answers are true and correct to the best of my knowledge and belief. I understand that any false or misleading statement may result in the permanent refusal of a visa or denial of entry into the United States.",
      M + 8,
      doc.y,
      { width: contentW - 16, lineGap: 1.5 },
    );

    pageFooters(doc, F.sans, "DS-160 · Application ID AA00D7K2ML · PATEL, MAYA");
  },
);

// =====================================================================================
// 2. Resume — one page, Georgia
// =====================================================================================
await writePdf(
  "Resume_Maya_Patel.pdf",
  { title: "Maya Patel — Resume", author: "Maya Patel" },
  (doc, F) => {
    doc.font(F.serifBold).fontSize(21).fillColor("#111").text("Maya Patel", { align: "center" });
    doc.font(F.serif).fontSize(9.5).fillColor("#333").text("Atlanta, GA  ·  maya.patel@example.com  ·  (404) 555-0142  ·  github.com/mpatel-demo", { align: "center" });
    doc.y += 6;
    rule(doc, { color: "#111", width: 0.8 });
    doc.y += 8;

    const section = (t) => {
      doc.y += 4;
      doc.font(F.serifBold).fontSize(10.5).fillColor("#111").text(t.toUpperCase());
      rule(doc, { color: "#888", width: 0.4, y: doc.y + 1 });
      doc.y += 7;
    };
    const bullets = (items) => {
      for (const it of items) {
        const y = doc.y;
        doc.font(F.serif).fontSize(9.8).fillColor("#222").text("•", M + 8, y, { lineBreak: false });
        doc.text(it, M + 20, y, { width: contentW - 20, lineGap: 1 });
        doc.y += 1.5;
      }
      doc.x = M;
    };

    section("Summary");
    doc.font(F.serif).fontSize(9.8).fillColor("#222").text(
      "Backend software engineer with four years of experience building distributed data systems and analytics platforms. Strong background in Go, Python, Kafka and cloud-native infrastructure; comfortable owning services end to end, from design review to on-call.",
      { lineGap: 1.5 },
    );

    section("Experience");
    lineLR(doc, "Northstar Systems LLC", "Atlanta, GA", { font: F.serifBold, size: 10.5 });
    lineLR(doc, "Software Engineer II", "January 15, 2024 – Present", { font: F.serifItalic, size: 9.8, color: "#333" });
    bullets([
      "Designed and shipped the event-ingestion service for Northstar's logistics analytics platform (Go, Kafka, Postgres), reducing p95 latency by 38% and cutting duplicate events to near zero.",
      "Built the internal data-quality monitoring pipeline used by the analytics and customer-success teams; alerts now catch schema drift before it reaches customer dashboards.",
      "Mentor two junior engineers and lead the weekly backend design review.",
    ]);
    doc.y += 5;
    lineLR(doc, "Cobalt Analytics Inc.", "Austin, TX", { font: F.serifBold, size: 10.5 });
    lineLR(doc, "Data Engineer", "August 2021 – December 2023", { font: F.serifItalic, size: 9.8, color: "#333" });
    bullets([
      "Owned ETL pipelines processing 2B+ daily events on Spark and Airflow across three product lines.",
      "Migrated the reporting warehouse from Redshift to Snowflake with zero customer-facing downtime; reduced monthly warehouse spend by 27%.",
      "Recognized with the 2023 Engineering Impact Award.",
    ]);
    doc.y += 5;
    lineLR(doc, "The University of Texas at Austin", "Austin, TX", { font: F.serifBold, size: 10.5 });
    lineLR(doc, "Graduate Research Assistant, Data Systems Lab", "September 2019 – May 2021", { font: F.serifItalic, size: 9.8, color: "#333" });
    bullets(["Research on streaming query optimization; co-authored one workshop paper (DEBS 2021)."]);

    section("Education");
    lineLR(doc, "The University of Texas at Austin", "May 2021", { font: F.serifBold, size: 10.5 });
    doc.font(F.serif).fontSize(9.8).fillColor("#222").text("M.S., Computer Science · GPA 3.8/4.0");
    doc.y += 4;
    lineLR(doc, "Gujarat Technological University", "May 2018", { font: F.serifBold, size: 10.5 });
    doc.font(F.serif).fontSize(9.8).fillColor("#222").text("B.Tech., Computer Engineering · First Class with Distinction");

    section("Technical Skills");
    const skills = [
      ["Languages", "Go, Python, TypeScript, SQL"],
      ["Data & Streaming", "Kafka, Spark, Airflow, Postgres, Snowflake, Redis"],
      ["Infrastructure", "Kubernetes, AWS (EKS, S3, Kinesis), Terraform, GitHub Actions"],
    ];
    for (const [k, v] of skills) {
      const y = doc.y;
      doc.font(F.serifBold).fontSize(9.8).fillColor("#222").text(k, M, y, { width: 120, lineBreak: false });
      doc.font(F.serif).fontSize(9.8).fillColor("#222").text(v, M + 120, y, { width: contentW - 120 });
      doc.y += 2;
    }
  },
);

// =====================================================================================
// 3. Employment verification letter — company letterhead
// =====================================================================================
await writePdf(
  "Employment_Verification_Letter_Northstar.pdf",
  { title: "Employment Verification — Maya Patel", author: "Northstar Systems LLC" },
  (doc, F) => {
    const blue = "#12355b";
    const teal = "#1f8a8a";
    // Logo mark: four-point star
    const cx = M + 14;
    const cy = M + 14;
    doc.save();
    doc
      .polygon([cx, cy - 14], [cx + 4, cy - 4], [cx + 14, cy], [cx + 4, cy + 4], [cx, cy + 14], [cx - 4, cy + 4], [cx - 14, cy], [cx - 4, cy - 4])
      .fill(blue);
    doc.polygon([cx, cy - 6], [cx + 2, cy - 2], [cx + 6, cy], [cx + 2, cy + 2], [cx, cy + 6], [cx - 2, cy + 2], [cx - 6, cy], [cx - 2, cy - 2]).fill(teal);
    doc.restore();
    doc.font(F.sansBold).fontSize(17).fillColor(blue).text("NORTHSTAR", M + 36, M + 1, { lineBreak: false });
    doc.font(F.sans).fontSize(8).fillColor(teal).text("S Y S T E M S", M + 36, M + 20, { lineBreak: false });
    doc.font(F.sans).fontSize(8.5).fillColor("#444");
    doc.text("1180 Peachtree Street NE, Suite 2400", M, M + 2, { width: contentW, align: "right", lineBreak: false });
    doc.text("Atlanta, Georgia 30309", M, M + 13, { width: contentW, align: "right", lineBreak: false });
    doc.text("+1 (404) 555-0170  ·  people-ops@northstar-systems.example", M, M + 24, { width: contentW, align: "right", lineBreak: false });
    doc.y = M + 40;
    rule(doc, { color: blue, width: 1.2 });
    doc.y += 26;

    const body = (t, opts = {}) => doc.font(F.times).fontSize(11.5).fillColor("#111").text(t, { lineGap: 2.2, align: "justify", ...opts });
    body("May 28, 2024", { align: "left" });
    doc.y += 14;
    body("Consular Section\nU.S. Consulate General, Mumbai\nC-49, G-Block, Bandra Kurla Complex\nMumbai 400051, India", { align: "left" });
    doc.y += 14;
    doc.font(F.timesBold).fontSize(11.5).fillColor("#111").text("Re:  Employment Verification — Ms. Maya Patel (DOB April 12, 1996)");
    doc.y += 12;
    body("To Whom It May Concern:", { align: "left" });
    doc.y += 8;
    body(
      'This letter confirms the employment of Ms. Maya Patel with Northstar Systems LLC ("Northstar"), a Delaware limited liability company headquartered in Atlanta, Georgia. Northstar builds logistics analytics software for freight carriers and third-party logistics providers and currently employs 214 people in the United States.',
    );
    doc.y += 8;
    body(
      "Ms. Patel began providing services to Northstar as an independent contractor on January 15, 2024, engaged through a professional services agreement to support the launch of our event-ingestion platform. On March 1, 2024, Ms. Patel converted to full-time employment with Northstar in the position of Software Engineer II. She has held that position continuously since that date.",
    );
    doc.y += 8;
    body(
      "Ms. Patel's current annual base salary is $132,000, paid semi-monthly, and she is eligible for Northstar's standard benefits program, including health, dental and vision coverage and a 401(k) with company match. Her primary work location is our Atlanta headquarters at the address above. Her position requires at minimum a bachelor's degree in computer science or a closely related field, and her duties include designing and implementing backend services for our analytics platform, maintaining data pipelines, and participating in design and code review.",
    );
    doc.y += 8;
    body(
      "Northstar intends to continue employing Ms. Patel in this role for the duration of the approved H-1B petition. Please do not hesitate to contact our People Operations team at the number above should you require any further information.",
    );
    doc.y += 14;
    body("Sincerely,", { align: "left" });
    doc.y += 6;
    const sy = doc.y;
    doc.font(F.script).fontSize(F.script === "Script" ? 22 : 15).fillColor("#1b2b6b").text("Renata Voss", M + 4, sy);
    doc.moveTo(M, sy + 28).lineTo(M + 220, sy + 28).strokeColor("#333").lineWidth(0.5).stroke();
    doc.y = sy + 33;
    doc.x = M;
    body("Renata Voss\nDirector of People Operations\nNorthstar Systems LLC", { align: "left" });
    doc.y += 18;
    doc.font(F.times).fontSize(10).fillColor("#333").text(`cc:  ${FIRM.attorney}, Esq., ${FIRM.name} (counsel for Ms. Patel)`);

    pageFooters(doc, F.sans, "Northstar Systems LLC  ·  northstar-systems.example  ·  Confidential — provided for immigration purposes");
  },
);

// =====================================================================================
// 4. International travel record — firm worksheet prepared from passport review
// =====================================================================================
function firmLetterhead(doc, F) {
  const navy = "#0f2a4a";
  doc.font(F.serifBold).fontSize(19).fillColor(navy).text(FIRM.name.toUpperCase(), M, M, { lineBreak: false });
  doc.font(F.serifItalic).fontSize(9).fillColor("#555").text(FIRM.practice, M, M + 23, { lineBreak: false });
  doc.font(F.sans).fontSize(8.5).fillColor("#444");
  doc.text(FIRM.address1, M, M + 2, { width: contentW, align: "right", lineBreak: false });
  doc.text(FIRM.address2, M, M + 13, { width: contentW, align: "right", lineBreak: false });
  doc.text(`${FIRM.phone}  ·  ${FIRM.email}`, M, M + 24, { width: contentW, align: "right", lineBreak: false });
  doc.y = M + 40;
  rule(doc, { color: navy, width: 1.2 });
  rule(doc, { color: navy, width: 0.4, y: doc.y + 3 });
  doc.y += 22;
  doc.x = M;
  return navy;
}

await writePdf(
  "Travel_History_Record_Maya_Patel.pdf",
  { title: "International Travel Record — Maya Patel", author: FIRM.name },
  (doc, F) => {
    const navy = firmLetterhead(doc, F);
    doc.font(F.serifBold).fontSize(15).fillColor("#111").text("International Travel Record");
    doc.font(F.sans).fontSize(9.5).fillColor("#444").text("Five-year travel chronology · prepared from passport review and client-provided airline confirmations");
    doc.y += 12;

    const kv = (pairs) => {
      const labelW = 150;
      for (const [k, v] of pairs) {
        const y = doc.y;
        doc.font(F.sansBold).fontSize(9).fillColor("#444").text(k, M, y, { width: labelW, lineBreak: false });
        doc.font(F.sans).fontSize(9.5).fillColor("#111").text(v, M + labelW, y, { width: contentW - labelW });
        doc.y += 3;
      }
      doc.x = M;
    };
    kv([
      ["Traveler", "Maya Patel"],
      ["Matter", `${FIRM.matter} · H-1B Consular Processing (Mumbai)`],
      ["Passport", "India · Z7261904 · issued September 3, 2019 · expires September 2, 2029"],
      ["Prepared", "May 20, 2024 — compiled from passport entry/exit stamps and airline confirmations"],
      ["Provided to", `${FIRM.attorney}, Esq., ${FIRM.name}, in support of H-1B consular processing`],
    ]);

    const section = (t) => {
      doc.y += 10;
      doc.font(F.serifBold).fontSize(11).fillColor(navy).text(t);
      rule(doc, { color: "#999", width: 0.4, y: doc.y + 1 });
      doc.y += 8;
    };

    section("Trips Outside the United States — Last Five Years");
    const widths = [28, 100, 100, 136, 120];
    const rowH = 20;
    let y = doc.y;
    const draw = (cells, head) => {
      if (head) doc.rect(M, y, contentW, rowH).fill("#eef1f6");
      let x = M;
      cells.forEach((c, i) => {
        doc.font(head ? F.sansBold : F.sans).fontSize(8.8).fillColor("#111").text(String(c), x + 6, y + 6, { width: widths[i] - 10, lineBreak: false });
        x += widths[i];
      });
      doc.moveTo(M, y + rowH).lineTo(M + contentW, y + rowH).strokeColor("#c9ceda").lineWidth(0.5).stroke();
      y += rowH;
    };
    draw(["#", "Departure", "Return", "Destination", "Purpose"], true);
    [
      ["1", "June 10, 2023", "June 17, 2023", "Toronto, Canada", "Professional conference"],
      ["2", "December 20, 2023", "January 8, 2024", "Mumbai, India", "Family visit"],
      ["3", "February 14, 2024", "February 21, 2024", "London, United Kingdom", "Personal travel"],
    ].forEach((r) => draw(r, false));
    doc.y = y + 4;
    doc.x = M;

    section("Stamp Detail");
    const p = (t) => {
      doc.font(F.sans).fontSize(9.5).fillColor("#222").text(t, { lineGap: 1.8 });
      doc.y += 4;
    };
    p("Entry 1 — Canada Border Services Agency admission stamp dated 10 JUN 2023, Toronto Pearson (YYZ). U.S. re-entry stamp 17 JUN 2023, Austin-Bergstrom (AUS). Airline confirmation: Air Canada AC 8781 / AC 1626.");
    p("Entry 2 — Bureau of Immigration India arrival stamp 21 DEC 2023, Mumbai (BOM). U.S. re-entry stamp 08 JAN 2024, Atlanta (ATL). Airline confirmation: Qatar Airways QR 730 / QR 556.");
    p("Entry 3 — UK Border Force admission stamp 15 FEB 2024, London Heathrow (LHR). U.S. re-entry stamp 21 FEB 2024, Atlanta (ATL). Airline confirmation: Delta DL 30 / DL 31.");
    p("Passport pages 6–11 reviewed; no other foreign entry or exit stamps for the period. Canada admission recorded by stamp (pre-eGate).");

    section("Traveler Statement");
    p("I confirm the above record reflects all international travel I can identify from my passport and personal records for the period June 2019 to May 2024.");
    doc.y += 8;
    const sy = doc.y;
    doc.font(F.script).fontSize(F.script === "Script" ? 20 : 14).fillColor("#1b2b6b").text("M. Patel", M + 4, sy);
    doc.moveTo(M, sy + 26).lineTo(M + 220, sy + 26).strokeColor("#333").lineWidth(0.5).stroke();
    doc.y = sy + 30;
    doc.x = M;
    doc.font(F.sans).fontSize(9).fillColor("#333").text("Maya Patel", M, doc.y, { lineBreak: false });
    doc.text("May 20, 2024", M + 240, doc.y, { lineBreak: false });
    doc.y += 12;
    doc.y += 12;
    doc.font(F.sansBold).fontSize(8).fillColor("#666").text("Reviewed:  ", { continued: true });
    doc.font(F.sans).text(`P. Nakamura (Paralegal), May 20, 2024  ·  Attorney review: ${FIRM.attorney}, May 21, 2024`);

    pageFooters(doc, F.sans, `${FIRM.name}  ·  Matter ${FIRM.matter}  ·  Privileged & Confidential — Attorney Work Product`);
  },
);

// =====================================================================================
// 4b. Sublease agreement (sent by the client during the call)
// =====================================================================================
await writePdf(
  "Sublease_Agreement_415_Ponce_de_Leon.pdf",
  { title: "Residential Sublease Agreement", author: "Rohan Mehta" },
  (doc, F) => {
    doc.font(F.timesBold).fontSize(15).fillColor("#111").text("RESIDENTIAL SUBLEASE AGREEMENT", { align: "center" });
    doc.y += 14;
    const body = (t) => {
      doc.font(F.times).fontSize(11).fillColor("#111").text(t, { lineGap: 2, align: "justify" });
      doc.y += 7;
    };
    const clause = (n, title, t) => {
      doc.font(F.timesBold).fontSize(11).fillColor("#111").text(`${n}.  ${title}.  `, { continued: true });
      doc.font(F.times).text(t, { lineGap: 2, align: "justify" });
      doc.y += 7;
    };
    body(
      'This Sublease Agreement (the "Agreement") is entered into on January 6, 2024 between Rohan Mehta ("Sublessor") and Maya Patel ("Subtenant"). Sublessor is the tenant of the Premises described below under a lease with Ponce Terrace Apartments LLC (the "Master Lease") and has obtained the landlord\'s written consent to sublease.',
    );
    clause(1, "Premises", 'Sublessor subleases to Subtenant the residential unit located at 415 Ponce de Leon Avenue NE, Apartment 9, Atlanta, Georgia 30308 (the "Premises"), consisting of one furnished bedroom with shared use of the kitchen, living room and bathroom.');
    clause(2, "Term", "The term of this sublease begins on January 8, 2024 and ends on April 30, 2024. Subtenant shall vacate the Premises no later than 11:59 p.m. on April 30, 2024 unless the term is extended in a writing signed by both parties.");
    clause(3, "Rent", "Subtenant shall pay rent of $950.00 per month, due on the first day of each month, by electronic transfer to Sublessor. Rent for the first month is prorated to $736.00 for January 8 – January 31, 2024. Rent received more than five (5) days late is subject to a $50.00 late fee.");
    clause(4, "Security Deposit", "Subtenant shall pay a security deposit of $950.00 upon signing, to be returned within thirty (30) days after the end of the term, less any deductions for damage beyond ordinary wear and tear.");
    clause(5, "Utilities and Use", "Electricity, water, gas and internet are included in rent. The Premises shall be used solely as a private residence for Subtenant. Subtenant acknowledges receipt of the building rules under the Master Lease and agrees to comply with them.");
    clause(6, "Condition of Premises", "Subtenant has inspected the Premises and accepts them in their present condition. Subtenant shall return the Premises in the same condition, ordinary wear and tear excepted.");
    clause(7, "Governing Law", "This Agreement is governed by the laws of the State of Georgia. It constitutes the entire agreement between the parties regarding the Premises.");
    doc.y += 10;
    body("IN WITNESS WHEREOF, the parties have executed this Agreement on the date first written above.");
    doc.y += 8;

    const sig = (name, role, x) => {
      const y0 = doc.y;
      doc.font(F.script).fontSize(F.script === "Script" ? 19 : 13).fillColor("#1b2b6b").text(name, x + 4, y0);
      doc.moveTo(x, y0 + 26).lineTo(x + 200, y0 + 26).strokeColor("#333").lineWidth(0.5).stroke();
      doc.font(F.times).fontSize(10).fillColor("#111").text(`${name}, ${role}`, x, y0 + 30, { lineBreak: false });
      doc.font(F.times).fontSize(10).fillColor("#333").text("Date: January 6, 2024", x, y0 + 43, { lineBreak: false });
    };
    const y0 = doc.y;
    sig("Rohan Mehta", "Sublessor", M);
    doc.y = y0;
    sig("Maya Patel", "Subtenant", M + 260);
    doc.y = y0 + 70;

    pageFooters(doc, F.sans, "Residential Sublease — 415 Ponce de Leon Ave NE, Apt 9, Atlanta, GA 30308");
  },
  "during-call",
);

// =====================================================================================
// 5. Client intake questionnaire (DOCX) — firm form
// =====================================================================================
{
  const NAVY = "0F2A4A";
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BFC5D2" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const COLS = [4338, 5302]; // DXA; page 12240 minus 1300 margins each side
  const cell = (text, opts = {}) =>
    new TableCell({
      width: { size: opts.width ?? COLS[1], type: WidthType.DXA },
      shading: opts.shade ? { fill: "F1F3F7" } : undefined,
      borders,
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: !!opts.bold, size: 20, color: opts.color })] })],
    });
  const qa = (rows) =>
    new Table({
      width: { size: COLS[0] + COLS[1], type: WidthType.DXA },
      columnWidths: COLS,
      layout: "fixed",
      rows: rows.map(([q, a]) => new TableRow({ children: [cell(q, { bold: true, shade: true, width: COLS[0] }), cell(a, { width: COLS[1] })] })),
    });
  const heading = (t) =>
    new Paragraph({
      children: [new TextRun({ text: t, bold: true, size: 22, color: NAVY, font: "Georgia" })],
      spacing: { before: 320, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "9AA3B5", space: 2 } },
    });
  const para = (t, opts = {}) =>
    new Paragraph({
      children: [new TextRun({ text: t, size: opts.size ?? 21, italics: !!opts.italics, bold: !!opts.bold, color: opts.color })],
      spacing: { after: opts.after ?? 120 },
      alignment: opts.align,
    });

  const docx = new Document({
    creator: FIRM.name,
    title: "Client Intake Questionnaire — Nonimmigrant Visa",
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1300, bottom: 1100, left: 1300, right: 1300 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: FIRM.name.toUpperCase(), bold: true, size: 30, color: NAVY, font: "Georgia" }),
                  new TextRun({ text: `\t${FIRM.address1}, ${FIRM.address2}  ·  ${FIRM.phone}`, size: 16, color: "555555" }),
                ],
                tabStops: [{ type: "right", position: 9300 }],
                border: { bottom: { style: BorderStyle.DOUBLE, size: 6, color: NAVY, space: 4 } },
                spacing: { after: 200 },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${FIRM.name}  ·  Matter ${FIRM.matter}  ·  Confidential — Attorney-Client Privileged`, size: 15, color: "666666" }),
                  new TextRun({ text: "\tPage ", size: 15, color: "666666" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 15, color: "666666" }),
                  new TextRun({ text: " of ", size: 15, color: "666666" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: "666666" }),
                ],
                tabStops: [{ type: "right", position: 9300 }],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ children: [new TextRun({ text: "Client Intake Questionnaire", bold: true, size: 34, font: "Georgia", color: "111111" })], spacing: { after: 60 } }),
          para("Nonimmigrant Visa — H-1B Consular Processing", { size: 22, color: "444444", after: 200 }),
          qa([
            ["Client", "Maya Patel"],
            ["Matter No.", FIRM.matter],
            ["Responsible attorney", `${FIRM.attorney}`],
            ["Consular post", "U.S. Consulate General, Mumbai"],
            ["Completed by client on", "May 14, 2024"],
          ]),
          para(""),
          para(
            "Please answer every question completely and to the best of your knowledge. Your answers will be compared against your supporting documents (passport, employment letter, visa application, travel records) before your application is finalized. If you are unsure of an answer, say so rather than leaving it blank.",
            { italics: true, size: 19, color: "444444" },
          ),

          heading("Section 1 — Personal Details"),
          qa([
            ["Full legal name", "Maya Patel"],
            ["Other names used", "None"],
            ["Date of birth", "April 12, 1996"],
            ["Country of citizenship", "India"],
            ["Current U.S. immigration status", "F-1 (OPT)"],
            ["Passport number / expiry", "Z7261904 / September 2, 2029"],
            ["Email / phone", "maya.patel@example.com / (404) 555-0142"],
          ]),

          heading("Section 2 — Current Employment"),
          qa([
            ["Current employer", "Northstar Systems LLC"],
            ["Job title", "Software Engineer II"],
            ["Employment start date", "March 2024"],
            ["Employment type", "Full-time, W-2"],
            ["Work location", "Atlanta, GA (Peachtree Street office)"],
            ["Annual salary", "$132,000"],
            ["Supervisor", "Renata Voss (People Operations) / Eng. manager: Tom Alvarez"],
          ]),

          heading("Section 3 — Residential Address History (last 5 years)"),
          qa([
            ["Current address", "88 Peachtree Walk NE, Apt 12B, Atlanta, GA 30308 — since May 1, 2024"],
            ["Previous address", "2140 Lakeview Drive, Apt 7, Austin, TX 78703 — August 15, 2021 to December 31, 2023"],
            ["Address before that", "2400 Nueces Street, Unit 301, Austin, TX 78705 — August 1, 2019 to August 14, 2021"],
            ["Have you lived at any other address in the last five years?", "No"],
          ]),

          heading("Section 4 — International Travel (last 5 years)"),
          qa([
            ["Countries visited outside the U.S.", "Canada (June 2023), India (December 2023 – January 2024)"],
            ["Any other trips outside the U.S.?", "None that I recall"],
            ["Have you ever overstayed a visa or been refused entry to any country?", "No"],
          ]),

          heading("Section 5 — Declarations"),
          qa([
            ["Any gaps in employment longer than 30 days since 2021?", "No"],
            ["Any prior visa denials or refusals?", "No"],
            ["Any arrests, citations or immigration violations?", "No"],
            ["Anyone other than you assisting with this questionnaire?", "No"],
          ]),

          para(""),
          para("I declare that the information above is true and complete to the best of my knowledge.", { italics: true, size: 19 }),
          para("Client signature: Maya Patel (electronic)  ·  May 14, 2024", { size: 20 }),
          para(`Received by ${FIRM.name}: May 14, 2024  ·  Reviewed: P. Nakamura (Paralegal)`, { size: 17, color: "666666" }),
        ],
      },
    ],
  });
  const buf = await Packer.toBuffer(docx);
  for (const d of outDirs) fs.writeFileSync(path.join(d, "Client_Intake_Questionnaire_Maya_Patel.docx"), buf);
}

console.log("Generated sample documents in:");
for (const d of outDirs) console.log("  " + d);
