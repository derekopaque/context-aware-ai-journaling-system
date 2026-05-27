import os

import requests


AMAP_KEY = os.getenv("AMAP_KEY")

WEATHER_MAP = {
    "晴": "Sunny",
    "少云": "Mostly Sunny",
    "晴间多云": "Partly Cloudy",
    "多云": "Cloudy",
    "阴": "Overcast",
    "风": "Windy",
    "有风": "Windy",
    "大风": "Strong Wind",
    "飓风": "Hurricane",
    "热带风暴": "Tropical Storm",
    "阵雨": "Showers",
    "雷阵雨": "Thunderstorms",
    "雷阵雨伴有冰雹": "Thunderstorms with Hail",
    "小雨": "Light Rain",
    "中雨": "Moderate Rain",
    "大雨": "Heavy Rain",
    "暴雨": "Storm",
    "大暴雨": "Heavy Storm",
    "特大暴雨": "Severe Storm",
    "冻雨": "Freezing Rain",
    "雨夹雪": "Sleet",
    "阵雪": "Snow Flurries",
    "小雪": "Light Snow",
    "中雪": "Moderate Snow",
    "大雪": "Heavy Snow",
    "暴雪": "Snowstorm",
    "雾": "Foggy",
    "浓雾": "Dense Fog",
    "强势浓雾": "Severe Fog",
    "轻雾": "Mist",
    "霾": "Haze",
    "中度霾": "Moderate Haze",
    "重度霾": "Heavy Haze",
    "严重霾": "Severe Haze",
    "浮尘": "Dust",
    "扬沙": "Sand",
    "沙尘暴": "Duststorm",
    "强沙尘暴": "Severe Duststorm",
    "热": "Hot",
    "冷": "Cold",
    "未知": "Unknown",
}

def reverse_geocode_amap(lng: float, lat: float, radius: int = 200) -> dict:
    """
    AMap reverse geocoding:
    Input: lng, lat
    Output: human-readable address + optional POI
    """

    url = "https://restapi.amap.com/v3/geocode/regeo"
    params = {
        "key": AMAP_KEY,
        "location": f"{lng},{lat}",
        "radius": radius,
        "extensions": "all",
        "output": "JSON",
    }

    try:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        print(f"[AMap Geo Raw] {data}") # DEBUG
    except Exception as e:
        print(f"[AMap Geo Error] {e}")
        return {"status": "0", "info": str(e)}

    regeo = data.get("regeocode", {}) or {}
    address_comp = regeo.get("addressComponent", {})
    pois = regeo.get("pois", []) or []

    res = {
        "status": data.get("status"),
        "info": data.get("info"),
        "infocode": data.get("infocode"),
        "formatted_address": regeo.get("formatted_address").strip() if regeo.get("formatted_address") else None,
        "adcode": address_comp.get("adcode"), # Corrected access
        "top_poi": pois[0].get("name").strip() if (pois and pois[0].get("name")) else None,
    }
    print(f"[AMap] Reverse Geocode result: {res.get('formatted_address')} (Adcode: {res.get('adcode')})")
    return res

def get_weather_amap(adcode: str) -> dict:
    """
    AMap Weather API:
    https://restapi.amap.com/v3/weather/weatherInfo
    """
    print(f"[AMap Weather] Querying for adcode: {adcode}")
    if not adcode:
        return {"weather": "Unknown", "temperature": "N/A"}

    url = "https://restapi.amap.com/v3/weather/weatherInfo"
    params = {
        "key": AMAP_KEY,
        "city": str(adcode),
        "extensions": "base",
        "output": "JSON",
    }
    
    try:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        print(f"[AMap Weather Raw] {data}") # DEBUG
        lives = data.get("lives", [])
        if lives:
            live = lives[0]
            chinese_weather = live.get("weather", "未知")
            english_weather = WEATHER_MAP.get(chinese_weather, chinese_weather)

            w_res = {
                "weather": english_weather,
                "temperature": live.get("temperature"),
                "winddirection": live.get("winddirection"),
                "humidity": live.get("humidity")
            }
            print(f"[AMap] Weather fetch success: {english_weather} (from {chinese_weather}), {w_res['temperature']}C")
            return w_res
    except Exception as e:
        print(f"Weather Fetch Error: {e}")
    
    return {"weather": "Unknown", "temperature": "N/A"}
if __name__ == "__main__":

    lng, lat = 120.73700775568358 , 31.274234358177004,

    result = reverse_geocode_amap(lng, lat)

    print("status/info/infocode:",
          result["status"], result["info"], result["infocode"])
    print("formatted_address:", result["formatted_address"])
    print("top_poi:", result["top_poi"])
