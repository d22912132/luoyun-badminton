import sys
import os
import argparse
import base64
import json
import sqlite3
import qrcode
from PIL import Image, ImageDraw, ImageFont

def create_center_badge(size=76):
    """繪製落雲宗羽球靈印（白底、金邊環、碧玉羽毛、金絲飾帶、翡翠球頭）"""
    badge = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(badge)
    # 圓形白玉底座與金絲外環
    bdraw.ellipse([2, 2, size - 3, size - 3], fill=(255, 255, 255, 255), outline=(201, 169, 97, 255), width=3)
    
    gold = (201, 169, 97, 255)
    jade = (31, 107, 85, 255)
    cx, cy = size // 2, size // 2 + 1
    
    # 三片羽毛（碧玉色）
    bdraw.polygon([(cx - 16, cy - 2), (cx - 20, cy - 18), (cx - 10, cy - 20), (cx - 8, cy - 2)], fill=jade)
    bdraw.polygon([(cx - 7, cy - 2), (cx - 8, cy - 23), (cx + 8, cy - 23), (cx + 7, cy - 2)], fill=jade)
    bdraw.polygon([(cx + 8, cy - 2), (cx + 10, cy - 20), (cx + 20, cy - 18), (cx + 16, cy - 2)], fill=jade)
    # 金絲羽線帶
    bdraw.rectangle([cx - 13, cy - 2, cx + 13, cy + 2], fill=gold)
    # 半圓球頭
    bdraw.pieslice([cx - 11, cy + 1, cx + 11, cy + 21], 0, 180, fill=jade)
    return badge

def generate_standard_qr(code, date_text, output_path):
    """標準黑白版本（原版規格）"""
    qr = qrcode.QRCode(
        version=3,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4,
    )
    qr.add_data(code)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    canvas_width = qr_img.width
    canvas_height = qr_img.height + 150
    canvas = Image.new("RGB", (canvas_width, canvas_height), "white")
    canvas.paste(qr_img, (0, 0))

    draw = ImageDraw.Draw(canvas)
    font_candidates = [
        "C:/Windows/Fonts/msjhbd.ttc",
        "C:/Windows/Fonts/msjh.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
    ]
    font_title, font_date = None, None
    for fp in font_candidates:
        try:
            font_title = ImageFont.truetype(fp, 32)
            font_date = ImageFont.truetype(fp, 28)
            break
        except (IOError, OSError):
            continue
    if not font_title:
        font_title = font_date = ImageFont.load_default()

    draw.text((canvas_width // 2, qr_img.height + 20), "門禁QRCode", fill="black", anchor="mm", font=font_title)
    draw.text((canvas_width // 2, qr_img.height + 65), f"(日期：{date_text})", fill="black", anchor="mm", font=font_date)

    canvas.save(output_path)
    return canvas, output_path

def generate_talisman_qr(code, date_text, date_display, output_path):
    """落雲宗 · 仙門通行玉令精裝版（符合宗門設計規範）"""
    qr = qrcode.QRCode(
        version=3,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4,
    )
    qr.add_data(code)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#0B1311", back_color="white").convert("RGBA")

    # 嵌入中心白底金邊靈羽印記
    badge = create_center_badge(76)
    bx = (qr_img.width - badge.width) // 2
    by = (qr_img.height - badge.height) // 2
    qr_img.paste(badge, (bx, by), badge)

    # 仙門卡牌畫布：宣紙沉香暖底
    card_w, card_h = 450, 640
    card = Image.new("RGB", (card_w, card_h), "#FAF7F0")
    draw = ImageDraw.Draw(card)

    gold_hex = "#C9A961"
    # 雙層細緻金絲回紋滾邊
    draw.rectangle([8, 8, card_w - 9, card_h - 9], outline=gold_hex, width=2)
    draw.rectangle([13, 13, card_w - 14, card_h - 14], outline="#D5C39E", width=1)

    # 四角雲紋/回字轉角飾線
    bracket_len = 16
    for ox, oy, dx, dy in [(18, 18, 1, 1), (card_w - 19, 18, -1, 1), (18, card_h - 19, 1, -1), (card_w - 19, card_h - 19, -1, -1)]:
        draw.line([(ox, oy), (ox + dx * bracket_len, oy)], fill=gold_hex, width=2)
        draw.line([(ox, oy), (ox, oy + dy * bracket_len)], fill=gold_hex, width=2)

    font_path_bold = "C:/Windows/Fonts/msjhbd.ttc"
    font_path_reg = "C:/Windows/Fonts/msjh.ttc"
    try:
        f_head = ImageFont.truetype(font_path_bold, 13)
        f_title = ImageFont.truetype(font_path_bold, 26)
        f_sub = ImageFont.truetype(font_path_reg, 13)
        f_date = ImageFont.truetype(font_path_bold, 19)
        f_tip = ImageFont.truetype(font_path_reg, 13)
        f_code = ImageFont.truetype(font_path_reg, 12)
        f_seal = ImageFont.truetype(font_path_bold, 16)
    except (IOError, OSError):
        f_head = f_title = f_sub = f_date = f_tip = f_code = f_seal = ImageFont.load_default()

    # 頂部宗門名銜與標題
    draw.text((card_w // 2, 34), "─  落 雲 宗 · 仙 門 結 界  ─", fill="#8A7440", anchor="mm", font=f_head)
    draw.text((card_w // 2, 65), "仙門通行玉令", fill="#101A1E", anchor="mm", font=f_title)
    draw.text((card_w // 2, 94), "憑令入閣 · 結界自啟", fill="#3D6555", anchor="mm", font=f_sub)

    # QR Code 高對比中央托盤
    qr_x = (card_w - qr_img.width) // 2
    qr_y = 118
    draw.rectangle([qr_x - 3, qr_y - 3, qr_x + qr_img.width + 2, qr_y + qr_img.height + 2], outline="#C9A961", width=1)
    card.paste(qr_img.convert("RGB"), (qr_x, qr_y))

    # 下方有效日期與閘機感應指引
    display_title = f"有效日期：{date_text} ({date_display})" if date_display else f"有效日期：{date_text}"
    draw.text((card_w // 2 - 25, 520), display_title, fill="#101A1E", anchor="mm", font=f_date)
    draw.text((card_w // 2 - 25, 550), "請出示此令對準球館閘機掃描口", fill="#6E9E88", anchor="mm", font=f_tip)
    draw.text((card_w // 2 - 25, 574), f"通行編碼：{code}", fill="#8A7440", anchor="mm", font=f_code)

    # 傳統朱砂古印：落雲宗令
    seal_s = 52
    seal_x = card_w - 76
    seal_y = 514
    cinnabar = "#B83828"
    draw.rectangle([seal_x, seal_y, seal_x + seal_s, seal_y + seal_s], outline=cinnabar, width=2)
    draw.rectangle([seal_x + 3, seal_y + 3, seal_x + seal_s - 3, seal_y + seal_s - 3], outline="#E58D81", width=1)
    draw.text((seal_x + 13, seal_y + 14), "落", fill=cinnabar, anchor="mm", font=f_seal)
    draw.text((seal_x + 37, seal_y + 14), "雲", fill=cinnabar, anchor="mm", font=f_seal)
    draw.text((seal_x + 13, seal_y + 37), "宗", fill=cinnabar, anchor="mm", font=f_seal)
    draw.text((seal_x + 37, seal_y + 37), "令", fill=cinnabar, anchor="mm", font=f_seal)

    card.save(output_path)
    return card, output_path

def apply_to_database(db_path, target_date, date_display, image_path):
    """將產生的 QR Code 轉換為 Data URL 並自動寫入 data/club.sqlite"""
    if not os.path.exists(db_path):
        print(f"[錯誤] 找不到資料庫檔案：{db_path}")
        return False

    with open(image_path, "rb") as f:
        img_bytes = f.read()
    data_url = f"data:image/png;base64,{base64.b64encode(img_bytes).decode('ascii')}"

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT json FROM club WHERE id=1")
    row = cur.fetchone()
    if not row:
        print("[錯誤] 資料庫尚未初始化 club 資料表！")
        conn.close()
        return False

    state = json.loads(row[0])
    events = state.get("events", [])
    matched = None
    target_clean = target_date.replace("/", "-")
    for ev in events:
        ev_date = ev.get("date", "").replace("/", "-")
        if target_clean in ev_date or target_date in ev.get("dateText", ""):
            matched = ev
            break

    if not matched:
        print(f"[警告] 找不到日期符合 '{target_date}' 的活動！")
        conn.close()
        return False

    matched["gateQr"] = data_url
    matched["gateQrDate"] = date_display or target_date
    state["version"] = state.get("version", 1) + 1
    
    cur.execute("UPDATE club SET json=? WHERE id=1", (json.dumps(state, ensure_ascii=False),))
    conn.commit()
    conn.close()
    print(f"[成功] 已成功將門禁玉令寫入活動「{matched.get('title')}」（日期：{matched.get('date')}）！")
    print(f"       gateQrDate 設為：{matched['gateQrDate']}")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="產生羽球場門禁 QR Code 圖片並可自動配置進系統")
    parser.add_argument("--code", default="QRCo16H1695320695588192", help="門禁 QR Code 內容字串")
    parser.add_argument("--date", default="2026/09/25", help="標註日期 (格式: YYYY/MM/DD 或 YYYY-MM-DD)")
    parser.add_argument("--display-date", default="9/25 (五)", help="簡要顯示日期 (如: 9/25 (五))")
    parser.add_argument("--output", default="qrcode_20260925.png", help="輸出圖片檔名")
    parser.add_argument("--style", choices=["talisman", "standard"], default="talisman", help="風格: talisman(仙門通行玉令精裝版) 或 standard(標準黑白版)")
    parser.add_argument("--apply-db", action="store_true", help="是否自動同步寫入 data/club.sqlite")
    parser.add_argument("--db-path", default="data/club.sqlite", help="資料庫路徑")
    args = parser.parse_args()

    if args.style == "talisman":
        img, path = generate_talisman_qr(args.code, args.date, args.display_date, args.output)
        print(f"已成功產出「落雲宗 · 仙門通行玉令」：{path}")
    else:
        img, path = generate_standard_qr(args.code, args.date, args.output)
        print(f"已成功產出標準黑白門禁 QR Code：{path}")

    if args.apply_db:
        apply_to_database(args.db_path, args.date, args.display_date, path)

