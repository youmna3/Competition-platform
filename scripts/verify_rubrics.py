#!/usr/bin/env python3
"""Verify rubrics/rubrics.json against the original PDF rubrics.

Usage: python3 scripts/verify_rubrics.py <folder-with-the-six-PDFs>

Checks, for every template:
  * every section title, criterion title and criterion description appears
    verbatim (whitespace-normalised) in the PDF text;
  * each section's weight appears as "Section Weight: N points" in the PDF and
    equals (number of rows x 5);
  * the Score Summary maximums match the section weights and sum to 100;
  * the bonus maximum equals the PDF's "Optional Bonus - max N" and equals
    (bonus rows x 5);
  * the number of rows in the PDF equals the number of rows in the template.
Requires `pdftotext` (poppler-utils).
"""
import json, re, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "rubrics" / "rubrics.json").read_text())
pdf_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")


def norm(s: str) -> str:
    # pdftotext renders "Q&A" as "Q\n&A;" / "& &\nQA;" (a PDF encoding artefact)
    s = s.replace("&A;", "&A").replace("& &\nQA;", "& Q&A").replace("& &QA;", "& Q&A")
    s = re.sub(r"Q\s*\n\s*&A", "Q&A", s)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"(Testing|Hardware|presentation):(?=\S)", r"\1: ", s)
    return s.strip()


failures = 0
def check(cond, msg):
    global failures
    if not cond:
        failures += 1
        print("  FAIL:", msg)

for t in data["templates"]:
    matches = [p for p in pdf_dir.glob("*.pdf") if p.name.endswith(t["source_pdf"])]
    if not matches:
        print(f"[{t['id']}] PDF {t['source_pdf']} not found in {pdf_dir}"); failures += 1; continue
    raw = subprocess.run(["pdftotext", str(matches[0]), "-"], capture_output=True, text=True).stdout
    text = norm(raw)
    print(f"[{t['id']}] {t['title']}")
    check(norm(t["title"]) in text, "title")
    check(norm(t["subtitle"]) in text, "subtitle")
    check(norm(data["scale_instruction"]) in text, "scale instruction")
    check(norm(data["guidance"]) in text, "general guidance")
    for lvl in data["score_levels"]:
        check(norm(lvl["description"]) in text, f"score level {lvl['value']}")
    total = 0; rows = 0
    for s in t["sections"]:
        check(norm(s["title"]) in text, f"section title {s['title']}")
        check(f"Section Weight: {s['weight']} points" in text, f"weight {s['weight']} for {s['title']}")
        check(len(s["criteria"]) * 5 == s["weight"], f"{s['title']}: {len(s['criteria'])} rows x5 != {s['weight']}")
        # Score summary line: "<Section title> <max>"
        summary = text[text.rfind("Score Summary"):]
        check(f"{norm(s['title'])} {s['weight']}" in summary, f"score summary max for {s['title']}")
        for title, desc in s["criteria"]:
            check(norm(title) in text, f"criterion title '{title}'")
            check(norm(desc) in text, f"description for '{title}'")
        total += s["weight"]; rows += len(s["criteria"])
    check(total == t["core_max"] == 100, f"core total {total}")
    check("CORE TOTAL 100" in text, "CORE TOTAL 100 in PDF")
    b = t["bonus"]
    check(f"Optional Bonus - max {t['bonus_max']}" in text, f"bonus max {t['bonus_max']}")
    check(f"record separately, max {t['bonus_max']}" in text, "bonus summary max")
    check(len(b["criteria"]) * 5 == t["bonus_max"], "bonus rows x5 == bonus max")
    for title, desc in b["criteria"]:
        check(norm(title) in text, f"bonus title '{title}'")
        check(norm(desc) in text, f"bonus description '{title}'")
    # Residual check: remove every known string plus the form boilerplate; if
    # anything is left, the PDF contains text (e.g. an extra criterion) that
    # the digital template does not.
    known = [t["title"], t["subtitle"], data["scale_instruction"], data["guidance"]]
    known += [l["description"] for l in data["score_levels"]]
    for s in t["sections"] + [b]:
        for title, desc in s["criteria"]:
            known += [title, desc]
    known += [s["title"] for s in t["sections"]] + [b["title"]]
    residual = text
    for k in sorted(set(map(norm, known)), key=len, reverse=True):
        residual = residual.replace(k, " ")
    boiler = [
        "Continue using the same 1-5 scale. Enter one score for each specific judging task.",
        "OPTIONAL BONUS (record separately, max %d)" % t["bonus_max"], "Optional Bonus - max %d" % t["bonus_max"],
        "Specific Judging Task", "What the Judge Should Look For", "Score (1-5)", "Judge Note",
        "Team Name / #", "How to Score Every Row", "Project Name", "Judge Name", "Date",
        "Meets Expectations", "Weak", "Developing", "Strong", "Excellent", "(continued)",
        "Score Summary", "Section Subtotal", "Section Maximum", "Notes", "CORE TOTAL",
    ]
    for k in boiler:
        residual = residual.replace(k, " ")
    residual = re.sub(r"Section Weight: \d+ points|Page \d", " ", residual)
    residual = re.sub(r"[\d\s]+", " ", residual).strip()
    check(residual == "", f"unmatched PDF text: {residual[:300]!r}")
    print(f"  sections={len(t['sections'])} core_rows={rows} core_max={total} bonus_rows={len(b['criteria'])} bonus_max={t['bonus_max']}")

print("\nRESULT:", "ALL CHECKS PASSED" if failures == 0 else f"{failures} FAILURE(S)")
sys.exit(1 if failures else 0)
