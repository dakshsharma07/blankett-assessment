import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import type { CaseDocument, DocKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;

function kindOf(name: string, type: string): DocKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (lower.endsWith(".docx") || type.includes("wordprocessingml")) return "docx";
  if (lower.endsWith(".txt") || lower.endsWith(".md") || type.startsWith("text/")) return "txt";
  return null;
}

function normalize(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function parseOne(file: File): Promise<CaseDocument> {
  const kind = kindOf(file.name, file.type);
  if (!kind) throw new Error(`Unsupported file type: ${file.name} (use PDF, DOCX or TXT)`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 15 MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";
  let pages: number | undefined;
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const out = await extractText(pdf, { mergePages: true });
    text = out.text;
    pages = out.totalPages;
  } else if (kind === "docx") {
    const out = await mammoth.extractRawText({ buffer: buf });
    text = out.value;
  } else {
    text = buf.toString("utf8");
  }
  text = normalize(text);
  if (text.length < 20) {
    throw new Error(`${file.name} contains no extractable text (scanned images are not supported)`);
  }
  return {
    id: `doc_${Math.random().toString(36).slice(2, 10)}`,
    name: file.name,
    kind,
    size: file.size,
    pages,
    text,
    uploadedAt: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "No files received" }, { status: 400 });
  const documents: CaseDocument[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      documents.push(await parseOne(f));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return Response.json({ documents, errors });
}
