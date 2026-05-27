import os
import time as _time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# Support relative imports for Vercel deployment
try:
    from .llm import (
        translate_location_to_en, 
        generate_interpretation_from_event, 
        compare_location_semantics,
        evaluate_and_generate_clip,
        generate_story_from_clips,
        generate_title_from_image,
        decide_mood_prompt_timing
    )
    from .amap import reverse_geocode_amap, get_weather_amap
except ImportError:
    from llm import (
        translate_location_to_en, 
        generate_interpretation_from_event, 
        compare_location_semantics,
        evaluate_and_generate_clip,
        generate_story_from_clips,
        generate_title_from_image,
        decide_mood_prompt_timing
    )
    from amap import reverse_geocode_amap, get_weather_amap

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Standardized Event Entry Schema
class EventEntry(BaseModel):
    title: str
    time: Optional[str] = None
    additional_info: Optional[str] = None
    user_id: Optional[str] = "Unknown"

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/interpret")
async def interpret_event(event: EventEntry):
    """
    Main Endpoint: Receives an Event Entry and returns an AI Interpretation.
    This fulfills the logic where all interpretations are derived from entry info.
    """
    try:
        # 1. Clean the title to ensure it is a proper English Event Title
        print(f"[{event.user_id}] [Interpret] Translating title: {event.title}")
        english_title = translate_location_to_en(event.title)

        # 2. Generate interpretation using the full context of the Entry
        diary_line = generate_interpretation_from_event(
            title=english_title,
            time=event.time,
            additional_info=event.additional_info
        )

        return {
            "success": True,
            "data": {
                "event_entry": english_title,
                "interpretation": diary_line
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class PhotoAnalyzeRequest(BaseModel):
    base64_image: str
    user_id: Optional[str] = "Unknown"

@app.post("/analyze_photo")
async def analyze_photo(data: PhotoAnalyzeRequest):
    """
    Uses Qwen VL to analyze a photo and return an event title.
    """
    try:
        print(f"[{data.user_id}] [Analyze Photo] Request received")
        title, description = generate_title_from_image(data.base64_image)
        return {
            "success": True,
            "title": title,
            "description": description
        }
    except Exception as e:
        print(f"Photo analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class FilterLocationRequest(BaseModel):
    lng: float
    lat: float
    previous_context: Optional[str] = None
    previous_timestamp: Optional[int] = None  # Unix ms timestamp of the last recorded context
    user_id: Optional[str] = "Unknown"

@app.post("/filter_location")
async def filter_location(data: FilterLocationRequest):
    """
    Decides whether to create a new event based on semantic difference.
    1. Reverse Geocode (GPS -> Address)
    2. Compare with previous_context via LLM
    3. Return decision
    """
    try:
        # 1. Reverse Geocode
        geo_res = reverse_geocode_amap(data.lng, data.lat)
        if geo_res.get("status") != "1":
            raise HTTPException(status_code=400, detail="Geocoding failed")
        
        current_address = geo_res.get("formatted_address")
        poi = geo_res.get("top_poi")
        
        # Combine address + POI for better context
        full_current_context = f"{current_address} ({poi})" if poi else current_address
        
        # 2. Semantic Comparison (with time awareness)
        is_new_scene, new_title, duration = compare_location_semantics(
            full_current_context,
            data.previous_context,
            data.previous_timestamp
        )
        
        # 3. Fetch Weather
        adcode = geo_res.get("adcode")
        weather_data = get_weather_amap(adcode)
        
        # Log all details for debugging
        print(f"[{data.user_id}] [Filter] Raw Address: {current_address}")
        print(f"[{data.user_id}] [Filter] Raw POI: {poi}")
        print(f"[{data.user_id}] [Filter] Result: is_new={is_new_scene}, Location: {new_title}, Weather: {weather_data.get('weather')}, Temp: {weather_data.get('temperature')}, Delta: {duration}m")

        return {
            "should_create": is_new_scene,
            "new_title": new_title,
            "duration": round(duration, 1),
            "full_context": full_current_context,
            "weather": weather_data.get("weather", "Unknown"),
            "temperature": weather_data.get("temperature", "N/A")
        }

    except Exception as e:
        print(f"[{data.user_id}] Filter Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class ClipRequest(BaseModel):
    events_summary: str
    previous_clip: Optional[str] = None
    user_id: Optional[str] = "Unknown"

@app.post("/generate_clip")
async def generate_clip(data: ClipRequest):
    """
    Endpoint for many-to-one interpretation generation.
    """
    try:
        print(f"[{data.user_id}] [Generate Clip] Request received")
        result = evaluate_and_generate_clip(data.events_summary, data.previous_clip)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class StoryRequest(BaseModel):
    clips_text: str
    event_summaries: Optional[str] = None
    style: str = "Classic"
    user_id: Optional[str] = "Unknown"

@app.post("/generate_story")
async def generate_story(data: StoryRequest):
    """
    Endpoint for daily story synthesis.
    """
    try:
        print(f"[{data.user_id}] [Generate Story] Style: {data.style}")
        result = generate_story_from_clips(data.clips_text, data.style, data.event_summaries)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class MoodDecisionRequest(BaseModel):
    context: str
    event_title: Optional[str] = None
    weather: Optional[str] = None
    now_ts: Optional[int] = None
    daily_prompt_count: int = 0
    last_prompt_at: Optional[int] = None
    previous_mood: Optional[str] = None
    user_id: Optional[str] = "Unknown"


@app.post("/should_prompt_mood")
async def should_prompt_mood(data: MoodDecisionRequest):
    """
    Decide if the app should ask the user for mood now.
    Uses hard rules + LLM weighted decision.
    """
    try:
        print(f"[{data.user_id}] [Should Prompt Mood] Checking...")
        result = decide_mood_prompt_timing(
            context=data.context,
            event_title=data.event_title,
            weather=data.weather,
            now_ts=data.now_ts,
            daily_prompt_count=data.daily_prompt_count,
            last_prompt_at=data.last_prompt_at,
            previous_mood=data.previous_mood
        )
        return result
    except Exception as e:
        print(f"[{data.user_id}] [Mood Decision Error] {e}")
        return {
            "ask": data.daily_prompt_count == 0,
            "reason": "fallback_first_prompt",
            "question_text": "How are you feeling right now?",
            "confidence": 0.4
        }


class MoodSubmitRequest(BaseModel):
    event_id: str
    mood: str
    prompted_at: Optional[int] = None
    answered_at: Optional[int] = None
    reason: Optional[str] = None
    user_id: Optional[str] = "Unknown"


@app.post("/submit_mood")
async def submit_mood(data: MoodSubmitRequest):
    """
    Receives the user's mood reply for analytics / optional persistence.
    Current version returns ack because event storage is frontend-side.
    """
    try:
        print(
            f"[{data.user_id}] [Mood Submit] event={data.event_id}, mood={data.mood}, "
            f"prompted_at={data.prompted_at}, answered_at={data.answered_at}, reason={data.reason}"
        )
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
#