import pymupdf, sys
doc = pymupdf.open(sys.argv[1])
pages = [int(x) for x in sys.argv[2].split(",")]
for p in pages:
    page = doc[p-1]
    pix = page.get_pixmap(dpi=140)
    out = sys.argv[3] % p
    pix.save(out)
    print(out, pix.width, pix.height)
