import pymupdf, sys
doc = pymupdf.open(sys.argv[1])
p = int(sys.argv[2]); w = doc[p-1].rect.width; h = doc[p-1].rect.height
page = doc[p-1]
rect = pymupdf.Rect(0, 0, w, h*0.48)
pix = page.get_pixmap(dpi=300, clip=rect)
pix.save(sys.argv[3])
print(sys.argv[3], pix.width, pix.height)
