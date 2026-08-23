import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path("/Users/kyoungmin/Desktop/DBB/dabboba-app")
ASSET_DIR = ROOT / "public/assets/dabboba/ips"
SOURCES = json.loads((ASSET_DIR / "sources.json").read_text())
CELL_W, IMAGE_H, LABEL_H = 170, 242, 54
GAP, PAD, COLS = 14, 20, 5
ROWS = (len(SOURCES["sources"]) + COLS - 1) // COLS
FONT_PATH = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
FONT = ImageFont.truetype(FONT_PATH, 15)
SMALL = ImageFont.truetype(FONT_PATH, 11)
board = Image.new(
    "RGB",
    (PAD * 2 + CELL_W * COLS + GAP * (COLS - 1), PAD * 2 + (IMAGE_H + LABEL_H) * ROWS + GAP * (ROWS - 1)),
    "#E7E9E4",
)
draw = ImageDraw.Draw(board)

for index, source in enumerate(SOURCES["sources"]):
    row, column = divmod(index, COLS)
    x = PAD + column * (CELL_W + GAP)
    y = PAD + row * (IMAGE_H + LABEL_H + GAP)
    image = Image.open(ASSET_DIR / Path(source["file"]).name).convert("RGB")
    image = ImageOps.fit(image, (CELL_W, IMAGE_H), method=Image.Resampling.LANCZOS)
    board.paste(image, (x, y))
    draw.rectangle((x, y + IMAGE_H, x + CELL_W, y + IMAGE_H + LABEL_H), fill="#FCFCF8")
    label = source["nameKo"]
    if len(label) > 14:
        label = f"{label[:13]}…"
    draw.text((x + 8, y + IMAGE_H + 7), f"{index + 1:02d}  {label}", fill="#111411", font=FONT)
    draw.text((x + 8, y + IMAGE_H + 31), source["id"], fill="#626A62", font=SMALL)

output = ROOT / "work/qa/ip-contact-sheet.png"
output.parent.mkdir(parents=True, exist_ok=True)
board.save(output, optimize=True)
