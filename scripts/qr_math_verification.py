#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QR 樣本的離線整數驗算與模型識別分析。

執行：python scripts/qr_math_verification.py
僅使用 Python 標準函式庫；不連線、不讀取外部檔案、不產生 QR 圖片。
日期是公式的 01/15 錨點，不代表已確認實際換碼日。
未獨立標時的樣本日期屬於擬合對應，不能當成獨立時間證據。
"""

import base64
from math import gcd, prod

M = 10**16
A = 476574504059360
B = 2849449904504832

# 逐月差 DM = 100 * A mod M；同月上下半月差 DH = 14 * A mod M
DM = -2342549594064000
DH = -3327956943168960

BASE64_CASES = [
    (
        "樣本 A (2026/10/26)",
        "UVJDbzE2SDYwMjQ4MTQxNTgzNTUyMzIKCgoKCg==",
        b"QRCo16H6024814158355232\n\n\n\n\n",
    ),
    (
        "樣本 B (2026/03 下半)",
        "UVJDbzE2SDI0MjI2NjEzMTY4MDMyMzIKCgoKCg==",
        b"QRCo16H2422661316803232\n\n\n\n\n",
    ),
]

SAMPLES = [
    (1, 20260301, "5750618259972192"),
    (2, 20260315, "2422661316803232"),
    (3, 20260401, "3408068665908192"),
    (4, 20260415, "0080111722739232"),
    (5, 20260501, "1065519071844192"),
    (6, 20260515, "7737562128675232"),
    (7, 20260601, "8722969477780192"),
    (8, 20260615, "5395012534611232"),
    (9, 20260801, "4037870289652192"),
    (10, 20260715, "3052462940547232"),
    (11, 20260701, "6380419883716192"),
    (12, 20261001, "9352771101524192"),
    (13, 20261015, "6024814158355232"),
    (14, 20260901, "1695320695588192"),
    (15, 20260815, "0709913346483232"),
    (16, 20260215, "4765210910867232"),
]

SCREENSHOT_CASES = [
    ("LINE_ALBUM_Jar_261026_1.jpg", "2026-09-07", 20260901, "1695320695588192"),
    ("LINE_ALBUM_Jar_261026_2.jpg", "2026-08-31", 20260815, "0709913346483232"),
    ("LINE_ALBUM_Jar_261026_3.jpg", "2026-08-24", 20260815, "0709913346483232"),
    ("LINE_ALBUM_Jar_261026_4.jpg", "2026-08-17", 20260815, "0709913346483232"),
    ("LINE_ALBUM_Jar_261026_5.jpg", "2026-08-10", 20260801, "4037870289652192"),
    ("LINE_ALBUM_Jar_261026_6.jpg", "2026-07-27", 20260715, "3052462940547232"),
    ("LINE_ALBUM_Jar_261026_7.jpg", "2026-07-06", 20260701, "6380419883716192"),
    ("LINE_ALBUM_Jar_261026_8.jpg", "2026-06-29", 20260615, "5395012534611232"),
    ("LINE_ALBUM_Jar_261026_9.jpg", "2026-06-22", 20260615, "5395012534611232"),
    ("LINE_ALBUM_Jar_261026_10.jpg", "2026-06-15", 20260615, "5395012534611232"),
    ("LINE_ALBUM_Jar_261026_11.jpg", "2026-06-08", 20260601, "8722969477780192"),
    ("LINE_ALBUM_Jar_261026_12.jpg", "2026-06-01", 20260601, "8722969477780192"),
    ("LINE_ALBUM_Jar_261026_13.jpg", "2026-05-25", 20260515, "7737562128675232"),
    ("LINE_ALBUM_Jar_261026_14.jpg", "2026-05-18", 20260515, "7737562128675232"),
    ("LINE_ALBUM_Jar_261026_15.jpg", "2026-05-11", 20260501, "1065519071844192"),
    ("LINE_ALBUM_Jar_261026_16.jpg", "2026-05-04", 20260501, "1065519071844192"),
    ("LINE_ALBUM_Jar_261026_17.jpg", "2026-04-27", 20260415, "0080111722739232"),
    ("LINE_ALBUM_Jar_261026_18.jpg", "2026-04-20", 20260415, "0080111722739232"),
    ("LINE_ALBUM_Jar_261026_19.jpg", "2026-04-13", 20260401, "3408068665908192"),
    ("LINE_ALBUM_Jar_261026_20.jpg", "2026-04-06", 20260401, "3408068665908192"),
    ("LINE_ALBUM_Jar_261026_21.jpg", "2026-03-30", 20260315, "2422661316803232"),
    ("LINE_ALBUM_Jar_261026_22.jpg", "2026-03-23", 20260315, "2422661316803232"),
    ("LINE_ALBUM_Jar_261026_23.jpg", "2026-03-16", 20260315, "2422661316803232"),
    ("LINE_ALBUM_Jar_261026_24.jpg", "2026-03-09", 20260301, "5750618259972192"),
    ("LINE_ALBUM_Jar_261026_25.jpg", "2026-03-02", 20260301, "5750618259972192"),
    ("LINE_ALBUM_Jar_261026_26.jpg", "2026-02-23", 20260215, "4765210910867232"),
    ("LINE_ALBUM_Jar_261026_27.jpg", "2026-10-26", 20261015, "6024814158355232"),
]


def code(x, a=A, b=B):
    return (a * x + b) % M


def general_model(year, month, half, gamma):
    """一般化三參數仿射模型：
    year=2026 時與 YYYYMMDD 模型完全一致；跨年時由年係數 gamma 決定分支。
    """
    base_2026_m0 = (A * 20260001 + B) % M
    return (base_2026_m0 + gamma * (year - 2026) + DM * month + DH * half) % M


def period_model(year, month, half):
    """以 (12 * year + month) 連續月份與 half 計算之模型。"""
    total_months = (year - 2026) * 12 + month
    base_2026_m0 = (A * 20260001 + B) % M
    return (base_2026_m0 + DM * total_months + DH * half) % M


def check(condition, message):
    # 不使用 assert，避免 python -O 關閉驗算。
    if not condition:
        raise AssertionError(message)


def main():
    print("一、Base64 格式驗算")
    for label, encoded, expected in BASE64_CASES:
        raw = base64.b64decode(encoded, validate=True)
        check(raw == expected, f"Base64 {label} 解碼不同")
        check(len(raw) == 28, f"Base64 {label} 長度不同")
        check(raw[:7] == b"QRCo16H", "前綴不同")
        check(raw[7:23].isdigit(), "數字欄位不同")
        check(raw[23:] == b"\x0a" * 5, "換行欄位不同")
        check(base64.b64encode(raw).decode("ascii") == encoded,
              "Base64 正規重新編碼不同")
        print(f"{label}: {len(raw)} bytes; {raw!r}")

    print("\n二、16 個半月樣本與 27 張附獨立日期標記截圖逐位比對")
    observed = {}
    for number, x, expected in SAMPLES:
        got = f"{code(x):016d}"
        check(got == expected, f"樣本 {number} 不吻合")
        observed[x] = int(expected)
        print(f"{number:2}: {x}  {expected} == {got}  PASS")
    print("16/16 個半月樣本 PASS（含新增 2026/02 下半與 2026/08 下半）；3～10 月僅缺 9/15。")
    for fname, date_str, anchor_ymd, expected in SCREENSHOT_CASES:
        y, m, d = map(int, date_str.split("-"))
        calc_anchor = y * 10000 + m * 100 + (15 if d >= 15 else 1)
        check(calc_anchor == anchor_ymd, f"{fname} 錨點不符")
        check(f"{code(calc_anchor):016d}" == expected, f"{fname} 算式結果不符")
    print(f"27/27 張含獨立印製日期 (日期：YYYY/MM/DD) 截圖全數吻合（含 2026/06/15 當日即切換為下半月 20260615）。")

    print("\n三、直接以樣本差值驗算，避免只重複公式")
    upper = [observed[20260000 + 100 * m + 1] for m in range(3, 11)]
    month_diffs = [(right - left) % M for left, right in zip(upper, upper[1:])]
    check(len(month_diffs) == 7 and set(month_diffs) == {DM % M},
          "上半月逐月差值不同")
    half_diffs = []
    for m in range(3, 11):
        x = 20260000 + 100 * m + 1
        if x + 14 in observed:
            half_diffs.append((observed[x + 14] - observed[x]) % M)
    check(len(half_diffs) == 7 and set(half_diffs) == {DH % M},
          "同月半月差值不同")
    check(100 * A % M == DM % M, "100A 不符月差")
    check(14 * A % M == DH % M, "14A 不符半月差")
    check(7 * DM - 50 * DH == 15 * M, "比例關係不符")
    print(f"7 組逐月差：{DM % M}")
    print(f"7 組同月半月差：{DH % M}")
    print(f"7*DM - 50*DH = {7 * DM - 50 * DH} = 15*M")

    print("\n四、A/B 的兩組解")
    check(gcd(100, 14) == 2, "日期差 gcd 不符")
    check((DM - 7 * DH) % M == 953149008118720, "2A 推導不同")
    a2, b2 = A + M // 2, (B + M // 2) % M
    for _, x, expected in SAMPLES:
        check(code(x, a2, b2) == int(expected), "替代 A/B 配對不同")
        check((code(x, a2, B) - int(expected)) % M == M // 2,
              "只更換 A 的差異不符")
    print(f"A={A}, B={B}")
    print(f"A={a2}, B={b2}")
    print("兩組在所有奇數輸入等價；只換 A 不換 B 會偏移 M/2。")

    gamma_date = 10000 * A % M
    gamma_month = 12 * DM % M
    models = [("YYYYMMDD", gamma_date),
              ("連續月份", gamma_month),
              ("每年重設", 0)]
    print("\n五、模型與年係數")
    for name, gamma in models:
        print(f"{name}: gamma={gamma}")
    for month in range(1, 13):
        for half in (0, 1):
            x = 20260000 + 100 * month + 1 + 14 * half
            for name, gamma in models:
                check(general_model(2026, month, half, gamma) == code(x),
                      f"2026 年內模型 {name} 不同")
    print("三種模型在 2026 年全 24 個半月錨點完全一致。")

    print("\n六、題目提供的 11～12 月預測")
    forecasts = [(20261101, "7010221507460192"),
                 (20261115, "3682264564291232"),
                 (20261201, "4667671913396192"),
                 (20261215, "1339714970227232")]
    for x, expected in forecasts:
        got = f"{code(x):016d}"
        check(got == expected, "題目年內預測不同")
        print(f"{x}: {got} PASS（模型預測，非新觀測）")

    print("\n七、跨年候選分支")
    expected_january = [
        ("6180758041700192", "2852801098531232"),
        ("2325122319332192", "8997165376163232"),
        ("0435717448100192", "7107760504931232"),
    ]
    for (name, gamma), expected in zip(models, expected_january):
        got = tuple(f"{general_model(2027, 1, h, gamma):016d}" for h in (0, 1))
        check(got == expected, "跨年預期值不同")
        print(f"{name}: 上半 {got[0]}；下半 {got[1]}")
    check(20270101 - 20261201 == 8900, "日期整數跨年差不同")
    check(89 * DM % M == 1513086128304000, "跨年增量不同")
    for half in (0, 1):
        x = 20270101 + 14 * half
        check(code(x, a2, b2) == code(x), "替代 A/B 跨年不同")
        check(period_model(2027, 1, half)
              == general_model(2027, 1, half, gamma_month),
              "連續半月與連續月份模型不同")
    print("上述三種是代表例；任意 gamma 都能命中全部 2026 年樣本。")

    print("\n八、可排除的簡單模型")
    check((2 * DH - DM) % M == 5686635707726080,
          "等步長半月 k 檢查不同")
    print(f"2*DH-DM mod M = {(2 * DH - DM) % M} != 0")
    print("所以 C=a*k+b 的等步長連續半月模型不能吻合。")
    check((3 * DM - 20 * DH) % M == 9531490081187200,
          "01/16 單一日期仿射模型檢查不同")
    print(f"3*DM-20*DH mod M = {(3 * DM - 20 * DH) % M} != 0")
    print("所以直接以 YYYYMM01/16 做同一個日期仿射式不能吻合。")
    print("這不代表已確定實際換碼日；01/15 可只是內部期別標記。")

    print("\n九、有限樣本無法保證年內外推：構造反例")
    for _, x, expected in SAMPLES:
        month = (x // 100) % 100
        perturbation = prod(month - r for r in range(2, 11))
        check((code(x) + perturbation) % M == int(expected), "反例未吻合")
    print("原本 r=3..10 的反例已被新增的 2026/02 下半樣本排除；需改為 r=2..10：")
    print(f"11 月相差 {prod(11-r for r in range(2, 11))}")
    print(f"12 月相差 {prod(12-r for r in range(2, 11))}")

    print("\n十、仿射模型的結構性檢查")
    check(gcd(A, M) == 160, "gcd 不同")
    check(all(int(v) % 160 == 32 for _, _, v in SAMPLES), "模 160 餘數不同")
    print(f"gcd(A,M)={gcd(A, M)}，因此不是整個模 M 整數域的可逆置換。")


if __name__ == "__main__":
    main()
