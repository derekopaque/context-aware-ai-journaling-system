import requests
import json
import os
import socket
import time as _time
import datetime
from openai import OpenAI

# Get API keys from environment variables.
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_ENDPOINT = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"

QWEN_API_KEY = os.getenv("QWEN_API_KEY")
QWEN_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"


def get_common_headers():
    """Helper to return consistent headers for API calls"""
    return {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json"
    }


def translate_location_to_en(location_input: str) -> str:
    """
    Step: Converts any raw location text (Chinese or messy input)
    into a clean, concise English Event Title.
    """
    headers = get_common_headers()
    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": "Translate and simplify the input to a concise English event or location name. Return ONLY the name in English. DO NOT return any Chinese characters."
            },
            {"role": "user", "content": location_input}
        ],
        "temperature": 0.3
    }

    resp = requests.post(DEEPSEEK_ENDPOINT, headers=headers, data=json.dumps(payload), timeout=20)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def generate_title_from_image(base64_image: str) -> tuple[str, str]:
    """
    Analyzes an image and returns a short event title and detailed description using Qwen.
    """
    # Set longer timeouts for large image uploads
    socket.setdefaulttimeout(120.0)
    
    # Check if the base64 string already has the prefix, add it if not
    if not base64_image.startswith("data:image/"):
        image_url = f"data:image/jpeg;base64,{base64_image}"
    else:
        image_url = base64_image

    client = OpenAI(
        api_key=QWEN_API_KEY,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        timeout=120.0,
    )

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url", 
                    "image_url": {"url": image_url}
                },
                {
                    "type": "text", 
                    "text": "What event is happening in this photo? Summarize it as a short English event title (max 5 words, e.g., 'Having coffee', 'Working at office', 'Walking in the park', 'Cooking dinner'). Also, provide a detailed description of the photo to be used as context for a diary entry. Do not use Chinese characters. Output format MUST BE JSON: {\"title\": \"<short title>\", \"description\": \"<detailed description>\"}"
                }
            ]
        }
    ]

    try:
        completion = client.chat.completions.create(
            # qwen-vl-plus is the Vision-Language model needed for parsing image_urls
            model="qwen-vl-plus", 
            messages=messages,
            temperature=0.1
        )
        content = completion.choices[0].message.content.strip()
        
        # Clean up any potential markdown json blocks
        if content.startswith("```json"):
            content = content.replace("```json", "").replace("```", "").strip()
        elif content.startswith("```"):
            content = content.replace("```", "").strip()
            
        try:
            parsed = json.loads(content)
            return parsed.get("title", "Photo Event").strip(), parsed.get("description", "A photo uploaded by the user.").strip()
        except json.JSONDecodeError:
            print(f"Failed to parse Qwen JSON response: {content}")
            return "Photo Event", "A photo uploaded by the user."
            
    except Exception as e:
        print(f"Qwen Vision Error: {e}")
        return "Photo Event", "A photo uploaded by the user."


def generate_interpretation_from_event(title: str, time: str = None, additional_info: str = None) -> str:
    """
    Step: Generates the interpretation based strictly on the Event Entry details.
    This creates a reflective diary sentence using all available context.
    """
    headers = get_common_headers()

    # Construct context for the LLM based on Event Entry fields
    context = f"Event: {title}"
    if time:
        context += f", Time: {time}"
    if additional_info:
        context += f", Context: {additional_info}"

    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a journaling assistant. Write a first-person diary sentence based on the provided event details. "
                    "Incorporate environmental context (like weather) naturally if provided. Be natural and reflective."
                )
            },
            {
                "role": "user",
                "content": f"Based on this event entry: [{context}], write ONE natural diary sentence in English (max 20 words)."
            }
        ],
        "temperature": 0.6
    }

    resp = requests.post(DEEPSEEK_ENDPOINT, headers=headers, data=json.dumps(payload), timeout=20)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip().replace('"', '')


def compare_location_semantics(current_addr: str, previous_context: str = None, previous_timestamp: int = None) -> (bool, str):
    """
    Decides if the current location is semantically different from the previous context.
    previous_timestamp is only used to calculate stay duration for same-scene reports.
    It must not force-create a new event on its own.
    Returns: (should_create_new_entry, new_title, duration_minutes)
    """

    duration_minutes = 0.0

    if not previous_context:
        return True, translate_location_to_en(current_addr), duration_minutes

    if previous_timestamp is not None:
        try:
            # Check if previous_timestamp is from a different calendar day in UTC+8
            prev_dt = datetime.datetime.utcfromtimestamp(previous_timestamp / 1000.0) + datetime.timedelta(hours=8)
            curr_dt = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
            if prev_dt.date() != curr_dt.date():
                print(f"[Filter Override] New day detected ({prev_dt.date()} -> {curr_dt.date()}). Forcing Event Creation.")
                return True, translate_location_to_en(current_addr), 0.0
        except Exception as e:
            print(f"[Date Check Error] {e}")

    elapsed_hours = None
    if previous_timestamp is not None:
        elapsed_ms = int(_time.time() * 1000) - previous_timestamp
        elapsed_hours = elapsed_ms / (1000 * 60 * 60)
        duration_minutes = max(0.0, elapsed_ms / (1000 * 60))

    headers = get_common_headers()

    if elapsed_hours is not None:
        if elapsed_hours < 1:
            elapsed_minutes = int(elapsed_hours * 60)
            time_context = f"The user was last confirmed in the same scene {elapsed_minutes} minute(s) ago."
        else:
            time_context = f"The user was last confirmed in the same scene {elapsed_hours:.1f} hour(s) ago."
    else:
        time_context = "The elapsed time since the previous scene confirmation is unknown."

    system_prompt = (
        "You are a semantic location analyzer for a diary app. "
        "You must decide whether the user has moved to a genuinely DIFFERENT place.\n"
        f"Time context: {time_context}\n"
        "Core principle: If the POI name is the same, it is the same place. "
        "If the POI name is different, it is probably a new place.\n\n"
        "Rules:\n"
        "1. SAME POI = FALSE: If both the previous and current text contain the same named POI "
        "(e.g. both mention 'Renmin Park', or both mention 'Starbucks'), return FALSE. "
        "Ignore differences in surrounding address text, formatting, weather, or temperature.\n"
        "2. DIFFERENT POI = TRUE: If the POI name has clearly changed to a different real-world place "
        "(e.g. 'XJTLU Park' -> 'Suzhou Center Mall', or 'Library' -> 'Dormitory'), return TRUE.\n"
        "3. NOISE = FALSE: Weather changes, temperature changes, time passing, or address formatting "
        "differences alone are never a reason to return TRUE.\n"
        "4. WITHIN SAME VENUE = FALSE: Moving between shops within one mall, or wandering within one park, "
        "is NOT a new scene — unless the sub-locations are famous named attractions.\n"
        "5. DISTINCT ATTRACTIONS = TRUE: Within a large scenic area, moving between distinctly named "
        "attractions counts as a new scene (e.g. 'Broken Bridge' -> 'Leifeng Pagoda').\n"
        "6. Language Rule: EVERYTHING in your output (reasoning, titles) MUST be in English. NEVER return Chinese characters.\n"
        "7. Title Rule: Always provide a concise English name for the current location in 'new_title', even if is_new_scene is false.\n"
        "Output format: JSON { \"is_new_scene\": boolean, \"new_title\": string }\n\n"
        "FALSE examples (same place, do NOT create):\n"
        "- Prev: 'XJTLU' | Curr: 'XJTLU' (different weather) => false, new_title: 'XJTLU'\n"
        "- Prev: 'No.111 Renai Rd (XJTLU)' | Curr: 'Renai Road, Suzhou (XJTLU)' => false, new_title: 'XJTLU'\n"
        "- Prev: 'Suzhou Mall (Zara)' | Curr: 'Suzhou Mall (Apple)' => false, new_title: 'Suzhou Mall'\n"
        "- Prev: 'Starbucks Reserve' | Curr: 'Starbucks Reserve' (30 min later) => false, new_title: 'Starbucks Reserve'\n\n"
        "TRUE examples (real move, DO create):\n"
        "- Prev: 'XJTLU' | Curr: 'Suzhou Center Mall' => true, new_title: 'Suzhou Center Mall'\n"
        "- Prev: 'Home (Renai Rd)' | Curr: 'XJTLU Library' => true, new_title: 'XJTLU Library'\n"
        "- Prev: 'West Lake (Broken Bridge)' | Curr: 'West Lake (Leifeng Pagoda)' => true, new_title: 'Leifeng Pagoda'\n"
        "- Prev: 'XJTLU Campus (Library)' | Curr: 'XJTLU Campus (Dormitory)' => true, new_title: 'Dormitory'\n"
        "- Prev: 'Starbucks' | Curr: 'KFC' => true, new_title: 'KFC'\n"
    )

    user_content = f"Previous Context: {previous_context}\nCurrent Location: {current_addr}"

    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.1,
        "response_format": { "type": "json_object" }
    }

    try:
        resp = requests.post(DEEPSEEK_ENDPOINT, headers=headers, data=json.dumps(payload), timeout=20)
        resp.raise_for_status()
        result = resp.json()["choices"][0]["message"]["content"]
        parsed = json.loads(result)
        is_new = parsed.get("is_new_scene", False)
        new_title = parsed.get("new_title", "")

        # Post-process: Ensure no Chinese characters and no empty titles for logging
        import re
        has_chinese = bool(re.search(r'[\u4e00-\u9fff]', new_title))
        
        if not new_title or has_chinese:
            # If LLM failed to provide a clean English title, use the specialized translator
            new_title = translate_location_to_en(current_addr)
            
        return is_new, new_title, 0.0 if is_new else duration_minutes
    except Exception as e:
        print(f"LLM Error: {e}")
        # On error, fallback to translation for logging but return False for safety
        fallback_title = "Unknown Location"
        try:
            fallback_title = translate_location_to_en(current_addr)
        except:
            pass
        return False, fallback_title, duration_minutes

def decide_mood_prompt_timing(
    context: str,
    event_title: str = None,
    weather: str = None,
    now_ts: int = None,
    daily_prompt_count: int = 0,
    last_prompt_at: int = None,
    previous_mood: str = None
) -> dict:
    """
    Hybrid decision:
    1) Hard rules (quiet hours, daily cap, minimum interval)
    2) LLM decides whether this scene is worth prompting
    """
    now_ms = now_ts or int(_time.time() * 1000)
    hour = _time.localtime(now_ms / 1000).tm_hour
    min_interval_ms = 6 * 60 * 60 * 1000

    if daily_prompt_count >= 2:
        return {
            "ask": False,
            "reason": "daily_limit_reached",
            "question_text": "How are you feeling right now?",
            "confidence": 1.0
        }

    if hour >= 22 or hour < 8:
        return {
            "ask": False,
            "reason": "quiet_hours",
            "question_text": "How are you feeling right now?",
            "confidence": 1.0
        }

    if last_prompt_at and (now_ms - last_prompt_at) < min_interval_ms:
        return {
            "ask": False,
            "reason": "cooldown_not_met",
            "question_text": "How are you feeling right now?",
            "confidence": 1.0
        }

    # Ensure at least one chance in the evening.
    if daily_prompt_count == 0 and hour >= 20:
        return {
            "ask": True,
            "reason": "first_prompt_evening_fallback",
            "question_text": "How are you feeling right now?",
            "confidence": 0.9
        }

    headers = get_common_headers()
    system_prompt = (
        "You decide if a diary app should ask the user for a quick mood check right now.\n"
        "Output JSON only: {\"ask\": boolean, \"reason\": string, \"question_text\": string, \"confidence\": number}\n"
        "Rules:\n"
        "1. Ask only when this context is emotionally meaningful (e.g., long library stay, amusement park, hospital, exam, commute end).\n"
        "2. If context is low-signal or repetitive, skip.\n"
        "3. Keep question_text short and neutral in English.\n"
        "4. confidence must be between 0 and 1."
    )
    user_prompt = (
        f"Context: {context}\n"
        f"Event Title: {event_title or 'Unknown'}\n"
        f"Weather: {weather or 'Unknown'}\n"
        f"Daily Prompt Count: {daily_prompt_count}\n"
        f"Previous Mood: {previous_mood or 'Unknown'}\n"
        f"Local Hour: {hour}"
    )

    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    }

    try:
        resp = requests.post(DEEPSEEK_ENDPOINT, headers=headers, data=json.dumps(payload), timeout=20)
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        parsed = json.loads(raw)

        ask = bool(parsed.get("ask", False))
        reason = str(parsed.get("reason", "llm_decision"))[:120]
        question_text = str(parsed.get("question_text", "How are you feeling right now?"))[:80]
        confidence = float(parsed.get("confidence", 0.5))
        confidence = max(0.0, min(1.0, confidence))

        # Keep one minimum daily chance in late day windows.
        if daily_prompt_count == 0 and hour >= 18 and not ask:
            ask = True
            reason = "first_prompt_late_day_fallback"
            confidence = max(confidence, 0.55)

        return {
            "ask": ask,
            "reason": reason,
            "question_text": question_text,
            "confidence": confidence
        }
    except Exception as e:
        print(f"[Mood Decision LLM Error] {e}")
        return {
            "ask": daily_prompt_count == 0,
            "reason": "fallback_first_prompt",
            "question_text": "How are you feeling right now?",
            "confidence": 0.4
        }


def evaluate_and_generate_clip(events_summary: str, previous_clip: str = None) -> dict:
    """
    Evaluates events and generates short, descriptive clips without too much speculation.
    """
    headers = get_common_headers()
    
    prev_context_msg = f'The previous entry was: "{previous_clip}". ' if previous_clip else ''
    
    system_prompt = (
        "You are an Objective Event Narrator. Given events from a 1-hour window, "
        "write a brief, factual first-person description and a creative title.\n"
        "Rules:\n"
        "1. STRICT GROUNDING: Use ONLY the information provided (POI name, duration, weather, mood). "
            "DO NOT invent specific details like 'sunlight through windows', 'focused on coursework', or specific environments/actions that were not stated. No hallucination.\n"
        "2. MOOD & ATMOSPHERE: Use the detected 'Mood' (if provided) and 'Weather' NATURALLY to set the scene. "
            "If mood is missing, describe objectively. DO NOT repeat the same weather phrase mechanically.\n"
        "3. PERSPECTIVE on Duration and Density:\n"
        "   - IF an event has Duration > 60m: Use reflective words like 'spent a long time' or 'unhurried' to highlight the depth, rather than inventing what you did.\n"
        "   - IF there are multiple locations: Describe it as a continuous 'exploration' or 'segment of travel', focusing on the flow.\n"
        "4. Description Length: 2 to 3 natural sentences (approx. 30 words). Keep it descriptive but factual.\n"
        "5. Title: Create a short, creative title (max 5 words) for this activity.\n"
        f"{prev_context_msg}"
        "6. If these events continue the previous activity, set 'merge_with_previous': true and provide an updated summary.\n"
        "7. CONTINUITY: IF the current events continue a theme from the 'previous_clip', treat it as a 'Long Chapter' and focus on the sense of wandering/persistence.\n"
        "8. Output format: JSON { \"clips\": [ { \"title\": string, \"text\": string, \"merge_with_previous\": boolean } ] }.\n"
        "9. IMPORTANT: You may return multiple clips in the array ONLY IF the 1-hour window contains distinctly different, unrelated activities. Otherwise, output a single clip array!\n"
        "10. Language: English only."
    )
    
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Events: {events_summary}"}
        ],
        "temperature": 0.5, # Lower temperature for more factual output
        "response_format": { "type": "json_object" } 
    }

    try:
        resp = requests.post(DEEPSEEK_ENDPOINT, headers=headers, data=json.dumps(payload), timeout=45)
        resp.raise_for_status()
        result = resp.json()["choices"][0]["message"]["content"]
        return json.loads(result)
    except Exception as e:
        print(f"Clip Generation Error: {e}")
        return {"clips": []}


def generate_story_from_clips(clips_text: str, style: str = "Reflective", event_summaries: str = None) -> dict:
    """
    Combines multiple clips into a cohesive daily story based on the chosen style.
    Styles: Reflective, Objective, Emotional.
    Also returns a mood classification: positive, calm, stressed, or negative.
    event_summaries provides extra factual anchors from the original events.
    """
    headers = get_common_headers()
    
    style_prompts = {
        "Reflective": "thoughtful, balanced, and slightly philosophical, looking back at the day's flow",
        "Objective": "straightforward, chronological, and factual, like a clear record of progress",
        "Emotional": "vibrant, expressive, and focused on feelings and the atmosphere of the moments"
    }
    
    chosen_style = style_prompts.get(style, style_prompts["Reflective"])
    
    system_prompt = (
        f"You are a Personal Reflective Chronicler. Combine the following clips into a single, cohesive daily diary entry in English. "
        f"The tone should be {chosen_style}.\n"
        "Rules:\n"
        "1. GROUNDING IN FACTS: Use ONLY the information and details provided in the clips and event summaries. "
            "DO NOT invent events, names, conversations, or specific details that were not mentioned. No hallucination.\n"
        "2. EVENT SUMMARIES ARE THE FACT ANCHOR: If clips are vague, rely on the event summaries instead of making up details.\n"
        "3. SYNTHESIS OVER CREATION: Focus on weaving the separate moments together chronologically. "
            "Use transitions to bridge the clips into a seamless flow. Focus on the overall narrative arc of the day.\n"
        "4. AUTHENTIC TONE: Avoid overly dramatic or poetic tropes. It should feel like a personal reflection based on actual events, not a work of fiction.\n"
        "5. Length: 100-150 words.\n"
        "6. Also classify the overall emotional tone of the day into EXACTLY ONE of these four moods:\n"
        "   - 'positive': happy, excited, achieved something, social interactions\n"
        "   - 'calm': relaxed, peaceful, reading, meditating, resting\n"
        "   - 'stressed': busy, anxious, deadline pressure, fatigue\n"
        "   - 'negative': sad, frustrated, lonely, bored\n"
        "7. Output format: JSON { \"story_text\": string, \"mood\": string }\n"
        "8. LANGUAGE: Write the story_text in English."
    )

    user_content = f"Daily Clips:\n{clips_text}"
    if event_summaries:
        user_content += f"\n\nEvent Summaries:\n{event_summaries}"

    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.8,
        "response_format": { "type": "json_object" } 
    }

    try:
        resp = requests.post(DEEPSEEK_ENDPOINT, headers=headers, data=json.dumps(payload), timeout=45)
        resp.raise_for_status()
        result = resp.json()["choices"][0]["message"]["content"]
        return json.loads(result)
    except Exception as e:
        print(f"Story Generation Error: {e}")
        return {"story_text": "Failed to generate story. Please try again."}

    #push
