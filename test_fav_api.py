#!/usr/bin/env python3
"""
B站收藏夹API诊断脚本
用于排查 /x/v3/fav/resource/list 接口返回 "请求错误" 的根本原因。
测试维度：登录凭证、WBI签名、风控拦截。
"""

import urllib.request
import urllib.error
import json
import time
import hashlib
import re
import ssl

# ============================================================
# 配置区 —— 请根据实际情况修改
# ============================================================

# 从日志中提取的失败文件夹 media_id 列表
TEST_MEDIA_IDS = [3664953802, 3357859802, 3152653102, 2502006402]

# 请粘贴你的完整 B站 Cookie（从浏览器 F12 → Application → Cookies 复制）
# 格式示例: "SESSDATA=xxx; bili_jct=xxx; DedeUserID=xxx; buvid3=xxx; ..."
COOKIE = "SESSDATA=0d6f9740%2C1793339115%2Caac2a%2A51CjDdokRCHQaE7YOoc9DLlx6rFoeSwq-35GMyFoVDiNZKVZSBKRMH7-4OwwjZ79Hy3RYSVkZPSUhOTC16ZjRTekxLYXlSMktIQkkyNk1MQzVVbFoza2hEbExxZ1VPMDFFQkVPVGJKREtQNkZ0dEV2aU5GMW42YXhpVW96WmdMMVdBTF9BU0hzUElRIIEC"

# 公共收藏夹ID，用于对比测试（非登录态也可访问的）
PUBLIC_MEDIA_ID = None  # 如果不确定，保持 None

# 请求超时（秒）
TIMEOUT = 30

# ============================================================
# 工具函数
# ============================================================

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com/",
}


def extract_cookie_field(cookie: str, field: str) -> str | None:
    """从Cookie字符串中提取指定字段的值"""
    m = re.search(rf"{field}=([^;]+)", cookie)
    return m.group(1) if m else None


def http_get(url: str, headers: dict | None = None) -> dict:
    """发送GET请求，返回解析后的JSON"""
    req = urllib.request.Request(url, headers=headers or {})
    # 忽略SSL证书问题（某些代理环境）
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as resp:
            return {
                "status": resp.status,
                "body": json.loads(resp.read().decode("utf-8")),
            }
    except urllib.error.HTTPError as e:
        body = {}
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            pass
        return {"status": e.code, "body": body}
    except Exception as e:
        return {"status": 0, "body": {"message": str(e)}}


def get_wbi_keys(cookie: str) -> tuple[str, str]:
    """从 /x/web-interface/nav 获取 WBI 密钥"""
    headers = {**BASE_HEADERS}
    if cookie:
        headers["Cookie"] = cookie
    result = http_get("https://api.bilibili.com/x/web-interface/nav", headers)
    data = result.get("body", {}).get("data", {})
    img_url = data.get("wbi_img", {}).get("img_url", "")
    sub_url = data.get("wbi_img", {}).get("sub_url", "")
    if not img_url or not sub_url:
        raise RuntimeError(f"获取WBI密钥失败: {json.dumps(result, ensure_ascii=False)}")
    img_key = img_url.rsplit("/", 1)[-1].split(".")[0]
    sub_key = sub_url.rsplit("/", 1)[-1].split(".")[0]
    print(f"  [WBI] img_key={img_key}, sub_key={sub_key}")
    return img_key, sub_key


def enc_wbi(params: dict, img_key: str, sub_key: str) -> str:
    """生成WBI签名后的query string"""
    raw = img_key + sub_key
    mixin_key = "".join(raw[i] for i in MIXIN_KEY_ENC_TAB)[:32]

    wts = int(time.time())
    final_params = {**params, "wts": wts}
    # 过滤特殊字符并按key排序
    chr_filter = re.compile(r"[!'()*]")
    sorted_keys = sorted(final_params.keys())
    query = "&".join(
        f"{k}={chr_filter.sub('', str(final_params[k]))}"
        for k in sorted_keys
    )
    w_rid = hashlib.md5((query + mixin_key).encode()).hexdigest()
    return f"{query}&w_rid={w_rid}"


def print_section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def analyze_response(media_id: int, result: dict):
    """分析响应并给出诊断结论"""
    code = result["body"].get("code", "N/A")
    message = result["body"].get("message", "")
    http_status = result["status"]

    print(f"  HTTP状态码: {http_status}")
    print(f"  业务码 code: {code}")
    print(f"  消息 message: {message}")

    if http_status == 200 and code == 0:
        data = result["body"].get("data", {})
        media_count = data.get("info", {}).get("media_count", "?")
        medias = data.get("medias", [])
        print(f"  >> 请求成功！收藏夹内视频数: {media_count}, 本页返回: {len(medias)} 条")
        return "SUCCESS"

    if http_status == 412 or http_status == 429:
        print(f"  >> 诊断：触发限流（HTTP {http_status}），需要降低请求频率")
        return "RATE_LIMITED"

    if code == -101:
        print(f"  >> 诊断：未登录或Cookie已失效 (code=-101)")
        return "NOT_LOGGED_IN"

    if code == -400:
        print(f"  >> 诊断：业务校验失败 (code=-400)")
        # 进一步分析
        if "请求错误" in message:
            print(f"  >> 详细：服务端返回「请求错误」，常见原因：")
            print(f"     1) Cookie中缺少风控字段（buvid3, b_nut等）")
            print(f"     2) 账户被风控标记，需要验证手机号或改密码")
            print(f"     3) 接口需要WBI签名但未提供")
            print(f"     4) 请求参数不合法")
        return "BUSINESS_ERROR"

    if code == 62002 or code == 62004:
        print(f"  >> 诊断：收藏夹不可见（code={code}），可能是私密收藏夹且登录态无效")
        return "FOLDER_UNAVAILABLE"

    if code == -404:
        print(f"  >> 诊断：收藏夹不存在 (code=-404)")
        return "NOT_FOUND"

    if http_status == 0:
        print(f"  >> 诊断：网络连接失败: {message}")
        return "NETWORK_ERROR"

    print(f"  >> 诊断：未知错误")
    return "UNKNOWN"


# ============================================================
# 测试流程
# ============================================================

def test_nav_endpoint(cookie: str):
    """测试 /x/web-interface/nav 验证登录状态"""
    print_section("测试1: 验证登录状态 (/x/web-interface/nav)")
    headers = {**BASE_HEADERS}
    if cookie:
        headers["Cookie"] = cookie
    result = http_get("https://api.bilibili.com/x/web-interface/nav", headers)
    data = result["body"].get("data", {})
    is_login = data.get("isLogin", False)
    uid = data.get("mid", "?")
    uname = data.get("uname", "?")
    print(f"  isLogin: {is_login}")
    print(f"  UID: {uid}")
    print(f"  用户名: {uname}")

    # 检查Cookie关键字段
    if cookie:
        sessdata = extract_cookie_field(cookie, "SESSDATA")
        buvid3 = extract_cookie_field(cookie, "buvid3")
        bili_jct = extract_cookie_field(cookie, "bili_jct")
        dedeuserid = extract_cookie_field(cookie, "DedeUserID")
        b_nut = extract_cookie_field(cookie, "b_nut")
        print(f"  Cookie字段检测:")
        print(f"    SESSDATA: {'存在' if sessdata else '缺失'} ({sessdata[:8]+'...' if sessdata else 'N/A'})")
        print(f"    buvid3: {'存在' if buvid3 else '缺失 (风控关键字段!)'}")
        print(f"    bili_jct: {'存在' if bili_jct else '缺失 (CSRF防护字段)'}")
        print(f"    DedeUserID: {'存在' if dedeuserid else '缺失'}")
        print(f"    b_nut: {'存在' if b_nut else '缺失 (风控关键字段!)'}")
    return is_login, uid, result


def test_fav_no_cookie(media_id: int):
    """不带Cookie测试（验证是否为公开收藏夹）"""
    print_section(f"测试2: 无Cookie访问 media_id={media_id}")
    result = http_get(
        f"https://api.bilibili.com/x/v3/fav/resource/list?media_id={media_id}&pn=1&ps=20&platform=web&order=mtime",
        BASE_HEADERS,
    )
    return analyze_response(media_id, result)


def test_fav_with_cookie(media_id: int, cookie: str):
    """带Cookie测试"""
    print_section(f"测试3: 带Cookie访问 media_id={media_id}")
    headers = {**BASE_HEADERS, "Cookie": cookie}
    result = http_get(
        f"https://api.bilibili.com/x/v3/fav/resource/list?media_id={media_id}&pn=1&ps=20&platform=web&order=mtime",
        headers,
    )
    return analyze_response(media_id, result)


def test_fav_with_wbi(media_id: int, cookie: str, img_key: str, sub_key: str):
    """带WBI签名测试"""
    print_section(f"测试4: 带WBI签名访问 media_id={media_id}")
    signed_query = enc_wbi(
        {"media_id": media_id, "pn": 1, "ps": 20, "platform": "web", "order": "mtime"},
        img_key, sub_key,
    )
    headers = {**BASE_HEADERS}
    if cookie:
        headers["Cookie"] = cookie
    result = http_get(
        f"https://api.bilibili.com/x/v3/fav/resource/list?{signed_query}",
        headers,
    )
    return analyze_response(media_id, result)


def main():
    print("=" * 60)
    print("  B站收藏夹API诊断脚本")
    print(f"  时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    cookie = COOKIE.strip()

    # ========================
    # 阶段1: 验证登录状态
    # ========================
    is_login, uid, nav_result = test_nav_endpoint(cookie)

    if not is_login and not cookie:
        print("\n  ⚠ 未提供Cookie，将仅测试公开收藏夹访问")

    # ========================
    # 阶段2: 测试收藏夹API（无Cookie）
    # ========================
    target_media = TEST_MEDIA_IDS[0]
    test_fav_no_cookie(target_media)

    # ========================
    # 阶段3: 测试收藏夹API（带Cookie）
    # ========================
    if cookie:
        test_fav_with_cookie(target_media, cookie)

        # ========================
        # 阶段4: 测试WBI签名
        # ========================
        try:
            img_key, sub_key = get_wbi_keys(cookie)
            test_fav_with_wbi(target_media, cookie, img_key, sub_key)
        except Exception as e:
            print_section("测试4: 带WBI签名访问")
            print(f"  >> 无法获取WBI密钥: {e}")

    # ========================
    # 阶段5: 批量测试所有失败文件夹
    # ========================
    print_section("测试5: 批量测试所有失败文件夹（带Cookie）")
    for mid in TEST_MEDIA_IDS:
        headers = {**BASE_HEADERS}
        if cookie:
            headers["Cookie"] = cookie
        result = http_get(
            f"https://api.bilibili.com/x/v3/fav/resource/list?media_id={mid}&pn=1&ps=20&platform=web&order=mtime",
            headers,
        )
        code = result["body"].get("code", "N/A")
        msg = result["body"].get("message", "")
        status_icon = "[OK]" if code == 0 else "[FAIL]"
        print(f"  {status_icon} media_id={mid}: code={code}, message={msg}")

    # ========================
    # 总结
    # ========================
    print_section("诊断总结与建议")
    print(f"""
  基于测试结果，请对照以下场景采取行动：

  1. 若 /nav 返回 isLogin=False:
     -> Cookie已完全失效，需要重新登录获取新的SESSDATA

  2. 若 /nav 返回已登录，但收藏夹API返回 code=-400:
     -> 排查Cookie中是否缺少 buvid3、b_nut 等风控字段
     -> 在浏览器中手动访问一次B站收藏夹，观察是否需要验证码
     -> 检查账户是否被风控（尝试在浏览器隐身窗口登录）

  3. 若带WBI签名后请求成功:
     -> 接口已升级，需要在 biliApi.ts 的 getFavoriteVideos 中接入WBI签名

  4. 若所有请求均返回限流 (412/429):
     -> 降低请求频率，增大请求间隔

  5. 若仅部分media_id失败:
     -> 这些收藏夹可能已被删除或设为私密
""")

if __name__ == "__main__":
    main()
