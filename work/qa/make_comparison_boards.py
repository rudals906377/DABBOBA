from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path("/Users/kyoungmin/Desktop/DBB/dabboba-app")
QA = ROOT / "work" / "qa"
SOURCE = Path("/tmp/codex-remote-attachments/01a02a5a-2a47-7e01-bae1-7ac794055dd4/42B4ADB9-C03C-404E-AC6A-5F6B8F6676B2")
FONT_PATH = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

CELL_W = 393
CELL_H = 852
GAP = 20
PAD = 28
LABEL_H = 42
BACKGROUND = "#E8EAE5"
PAPER = "#F5F5F1"
INK = "#111411"
MUTED = "#626A62"
GREEN = "#91E98E"


def font(size: int, index: int = 0):
    try:
        return ImageFont.truetype(FONT_PATH, size=size, index=index)
    except OSError:
        return ImageFont.load_default()


TITLE_FONT = font(30)
LABEL_FONT = font(18)
SMALL_FONT = font(14)


def normalized(path: Path, size=(CELL_W, CELL_H), contain=False):
    image = Image.open(path).convert("RGB")
    if contain:
        return ImageOps.pad(image, size, color=PAPER, method=Image.Resampling.LANCZOS)
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


def add_cell(board, image, x, y, label):
    board.paste(image, (x, y + LABEL_H))
    draw = ImageDraw.Draw(board)
    draw.rounded_rectangle((x, y, x + CELL_W, y + LABEL_H - 8), radius=10, fill="#FCFCF8")
    draw.text((x + 12, y + 8), label, fill=INK, font=LABEL_FONT)


def make_flow_board():
    sources = [
        (SOURCE / "1-사진-1.jpg", "REFERENCE · LIST"),
        (SOURCE / "2-사진-2.jpg", "REFERENCE · DETAIL"),
        (SOURCE / "3-사진-3.jpg", "REFERENCE · QUANTITY"),
        (SOURCE / "4-사진-4.jpg", "REFERENCE · PAYMENT"),
    ]
    implementations = [
        (QA / "final-catalog.png", "DABBOBA · CATALOG"),
        (QA / "final-detail.png", "DABBOBA · DETAIL"),
        (QA / "final-quantity.png", "DABBOBA · QUANTITY"),
        (QA / "final-checkout.png", "DABBOBA · CHECKOUT"),
    ]
    title_h = 76
    width = PAD * 2 + CELL_W * 4 + GAP * 3
    height = PAD * 2 + title_h + (LABEL_H + CELL_H) * 2 + GAP
    board = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(board)
    draw.text((PAD, PAD), "DABBOBA FLOW COMPARISON", fill=INK, font=TITLE_FONT)
    draw.text((PAD, PAD + 39), "구조만 참고하고 색·제품·브랜드 표현은 독립적으로 재설계", fill=MUTED, font=SMALL_FONT)

    first_y = PAD + title_h
    second_y = first_y + LABEL_H + CELL_H + GAP
    for index, (path, label) in enumerate(sources):
        add_cell(board, normalized(path), PAD + index * (CELL_W + GAP), first_y, label)
    for index, (path, label) in enumerate(implementations):
        add_cell(board, normalized(path), PAD + index * (CELL_W + GAP), second_y, label)

    board.save(QA / "flow-comparison-board.png", optimize=True)


def make_style_board():
    title_h = 76
    width = PAD * 2 + CELL_W * 2 + GAP
    height = PAD * 2 + title_h + (LABEL_H + CELL_H) * 2 + GAP
    board = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(board)
    draw.text((PAD, PAD), "DABBOBA STYLE CHECK", fill=INK, font=TITLE_FONT)
    draw.text((PAD, PAD + 39), "그린은 기능 강조, 8비트 이미지는 약한 질감으로만 사용", fill=MUTED, font=SMALL_FONT)

    swatch = Image.new("RGB", (CELL_W, CELL_H), PAPER)
    swatch_draw = ImageDraw.Draw(swatch)
    swatch_draw.rounded_rectangle((42, 180, CELL_W - 42, 489), radius=40, fill=GREEN)
    swatch_draw.rectangle((76, 223, 317, 446), fill="#183C2F")
    swatch_draw.polygon([(106, 411), (265, 247), (327, 310), (168, 474)], fill="#58F78E")
    swatch_draw.text((42, 545), "PRIMARY GREEN", fill=INK, font=LABEL_FONT)
    swatch_draw.text((42, 579), "#91E98E", fill=MUTED, font=TITLE_FONT)

    texture = normalized(ROOT / "public/assets/dabboba/retro-arcade-texture.png", contain=True)
    catalog = normalized(QA / "final-catalog.png")
    draw_screen = normalized(QA / "final-draw.png")

    first_y = PAD + title_h
    second_y = first_y + LABEL_H + CELL_H + GAP
    add_cell(board, swatch, PAD, first_y, "REFERENCE · GREEN DIRECTION")
    add_cell(board, texture, PAD + CELL_W + GAP, first_y, "REFERENCE · TEXTURE ONLY")
    add_cell(board, catalog, PAD, second_y, "IMPLEMENTATION · CATALOG")
    add_cell(board, draw_screen, PAD + CELL_W + GAP, second_y, "IMPLEMENTATION · DRAW")
    board.save(QA / "style-comparison-board.png", optimize=True)


def make_responsive_board():
    samples = [
        (QA / "final-catalog.png", "iPHONE · 393×852"),
        (QA / "final-draw.png", "iPHONE · DRAW"),
        (QA / "final-pixel-catalog.png", "PIXEL 10 · 427×952"),
        (QA / "final-pixel-draw.png", "PIXEL 10 · DRAW"),
    ]
    title_h = 76
    width = PAD * 2 + CELL_W * 4 + GAP * 3
    height = PAD * 2 + title_h + LABEL_H + CELL_H
    board = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(board)
    draw.text((PAD, PAD), "RESPONSIVE DEVICE CHECK", fill=INK, font=TITLE_FONT)
    draw.text((PAD, PAD + 39), "두 기기에서 동일한 앱 구조와 안전영역 유지", fill=MUTED, font=SMALL_FONT)
    y = PAD + title_h
    for index, (path, label) in enumerate(samples):
        add_cell(board, normalized(path, contain=True), PAD + index * (CELL_W + GAP), y, label)
    board.save(QA / "responsive-comparison-board.png", optimize=True)


make_flow_board()
make_style_board()
make_responsive_board()
