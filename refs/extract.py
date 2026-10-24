import pymupdf, sys
src = sys.argv[1]; dst = sys.argv[2]
doc = pymupdf.open(src)
out = []
for i, p in enumerate(doc):
    out.append("\n\n===== PAGE %d =====\n" % (i+1))
    out.append(p.get_text())
full = "".join(out)
open(dst, "w", encoding="utf-8").write(full)
print("pages", doc.page_count, "chars", len(full))
