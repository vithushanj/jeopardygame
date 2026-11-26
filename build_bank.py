#!/usr/bin/env python3
"""Build clues.js from an Open Trivia Database dump.

    python3 build_bank.py fetch raw.json     # download every verified question (~10 min, rate-limited)
    python3 build_bank.py build raw.json     # reword + write clues.js
    python3 build_bank.py sample raw.json    # print 60 random before/after pairs

Questions are reworded by rule from "What is the capital of France?" into statement clues
("This is the capital of France.") with a question-form response ("What is Paris?").
Anything the rules can't convert confidently (true/false, "which of these", negatives, ...) is
dropped rather than shipped badly worded.

Source data: https://opentdb.com (CC BY-SA 4.0). The reworded output is an adaptation under the same licence.
"""
import json
import os
import random
import re
import sys
import time
import urllib.request
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
API = "https://opentdb.com"
DIFF = {"easy": 0, "medium": 1, "hard": 2}
MIN_PER_CATEGORY = 15

BE = r"(?:is|was|are|were)"
AUX = r"(?:did|does|do|would|can|could|should|will|has|have|had|might|must)"
PREP = r"(?:in|on|from|of|for|at|to|by|with|after|under|as|into)"
PART_WORDS = {
    "born", "made", "built", "held", "set", "shot", "sung", "known", "found", "won", "sold", "put", "sent",
    "begun", "done", "lost", "fought", "taught", "bought", "brought", "led", "run", "cast", "hit", "kept", "left",
    "paid", "said", "told", "worn", "torn", "drawn", "grown", "thrown", "shown", "laid", "struck", "spent",
}
PAST = {
    "release": "released", "begin": "began", "start": "started", "end": "ended", "win": "won", "become": "became",
    "die": "died", "fall": "fell", "take": "took", "open": "opened", "launch": "launched", "debut": "debuted",
    "premiere": "premiered", "happen": "happened", "occur": "occurred", "found": "founded", "land": "landed",
    "invent": "invented", "discover": "discovered", "join": "joined", "sign": "signed", "come": "came",
    "go": "went", "make": "made", "leave": "left", "first": None, "air": "aired", "sink": "sank", "gain": "gained",
    "declare": "declared", "publish": "published", "introduce": "introduced", "close": "closed", "create": "created",
    "host": "hosted", "move": "moved", "change": "changed", "get": "got", "receive": "received", "break": "broke",
    "split": "split", "form": "formed", "retire": "retired", "erupt": "erupted", "enter": "entered", "pass": "passed",
    "play": "played", "write": "wrote", "buy": "bought", "acquire": "acquired", "announce": "announced",
    "stop": "stopped", "collapse": "collapsed", "invade": "invaded", "adopt": "adopted", "originate": "originated",
}
PERSON_NOUNS = (
    "actor|actress|president|author|artist|singer|person|player|director|scientist|king|queen|man|woman|"
    "musician|rapper|writer|composer|painter|philosopher|emperor|leader|comedian|athlete|driver|poet|"
    "physicist|mathematician|inventor|astronaut|monarch|politician|general|pope|designer|developer|"
    "programmer|traitor|footballer|boxer|wrestler|rider|chef|drummer|guitarist|bassist|vocalist|host|god|goddess|character|member|celebrity"
)
EXCLUDE = re.compile(
    r"\b(of these|of the following|following|not|except|these|isn't|wasn't|aren't|doesn't|didn't|cannot|"
    r"which one|true|false|below|listed|all but)\b", re.I)


def is_part(w):
    w = w.lower()
    return w in PART_WORDS or bool(re.search(r"(ed|en|wn)$", w)) and len(w) > 3


def cap(s):
    return s[:1].upper() + s[1:]


def low(s):
    """Lower-case a leading wh-word/determiner only (leave proper nouns alone)."""
    return s[:1].lower() + s[1:] if re.match(r"(What|Which|Who|How|Where|When|The|A|An|In|This) ", s) else s


def split_participle(x, be):
    """'the Terracotta Army located' -> 'the Terracotta Army is located'."""
    words = x.split()
    for i in range(len(words) - 1, 0, -1):
        if words[i].islower() and is_part(words[i]):
            return " ".join(words[:i] + [be] + words[i:])
    return f"{x} {be}"


def did_clause(rest, tail):
    """'the Berlin Wall fall' -> 'the Berlin Wall fell <tail>' (None if no known verb)."""
    words = rest.split()
    for i, w in enumerate(words):
        if i and PAST.get(w):
            return " ".join(words[:i] + [PAST[w]] + words[i + 1:]) + " " + tail
    return None


def core(q, year):
    """q has no trailing '?'. Returns a statement (no final period) or None."""
    # leading scene-setter: 'In "Zelda", what is ...' -> recurse on the wh-part
    m = re.match(r"^((?:In|On|According to|As of|During|Within|From|At|By|With|Before|After) [^,]{2,90}, )((?:[Ii]n )?(?:what|which|who|how many|where|when)\b.*)$", q)
    if m:
        inner = core(cap(m.group(2)), year)
        return m.group(1) + low(inner) if inner else None

    # year questions
    m = re.match(rf"^(?:In )?(?:[Ww]hat|[Ww]hich) year ({BE}) (.+)$", q) or (year and re.match(rf"^When ({BE}) (.+)$", q))
    if m:
        words = m.group(2).split()
        if len(words) > 1 and is_part(words[-1]):
            return f"{' '.join(words[:-1])} {m.group(1)} {words[-1]} in this year"
        return None
    m = re.match(r"^(?:In )?(?:[Ww]hat|[Ww]hich) year did (.+)$", q) or (year and re.match(r"^When did (.+)$", q))
    if m:
        return did_clause(m.group(1), "in this year")
    if re.match(r"^When\b", q):
        return None

    # who
    m = re.match(r"^Who (\w+) (.+)$", q)
    if m:
        if re.fullmatch(AUX, m.group(1)):
            return None
        if m.group(1) in ("are", "were"):
            return f"These people {m.group(1)} {m.group(2)}"
        return f"This person {m.group(1)} {m.group(2)}"
    if re.match(r"^(Who|Whose|Whom)\b", q):
        return None

    # how many
    m = re.match(r"^How many (.+?) (are|were) there(.*)$", q)
    if m:
        return f"There {m.group(2)} this many {m.group(1)}{m.group(3)}"
    m = re.match(r"^How many (.+?) (does|do|did) (.+) have(.*)$", q)
    if m and not re.search(rf"\b({BE}|{AUX}|to)\b", m.group(3)):
        have = {"does": "has", "do": "have", "did": "had"}[m.group(2)]
        return f"{m.group(3)} {have} this many {m.group(1)}{m.group(4)}"
    m = re.match(rf"^How many (.+?) ({BE}) (.+)$", q)
    if m and len(m.group(1).split()) <= 5:
        first = m.group(3).split()[0]
        if first in ("the", "a", "an") or first[:1].isupper():
            return None
        return f"This many {m.group(1)} {m.group(2)} {m.group(3)}"
    if re.match(r"^How\b", q):
        return None

    # where
    m = re.match(rf"^Where ({BE}) (.+)$", q)
    if m:
        return split_participle(m.group(2), m.group(1)) + " here"
    if re.match(r"^Where\b", q):
        return None

    # 'In which country is the city of X located'
    m = re.match(rf"^In (?:which|what) (.+?) ({BE}) (.+)$", q)
    if m and len(m.group(1).split()) <= 4 and not re.search(rf"\b{AUX}\b", q) and not m.group(3).split()[0].islower():
        return split_participle(m.group(3), m.group(2)) + f" in this {m.group(1)}"
    m = re.match(r"^In (?:which|what) (.+?) did (.+)$", q)
    if m and len(m.group(1).split()) <= 4:
        return did_clause(m.group(2), f"in this {m.group(1)}")

    m = re.match(r"^(?:What|Which) (.+)$", q)
    if m:
        rest = m.group(1)
        # 'What is the capital of X' -> 'This is the capital of X'
        b = re.match(rf"^({BE}) (.+)$", rest)
        if b:
            return f"{'These' if b.group(1) in ('are', 'were') else 'This'} {b.group(1)} {b.group(2)}"
        if re.match(rf"^{AUX}\b", rest):
            return None
        # 'What city is the Terracotta Army located in' -> 'The Terracotta Army is located in this city'
        s = re.match(rf"^(.+?) ({BE}) (.+) ({PREP})$", rest)
        if s and len(s.group(1).split()) <= 5 and not re.search(rf"\b{AUX}\b", rest):
            return split_participle(s.group(3), s.group(2)) + f" {s.group(4)} this {s.group(1)}"
        # 'Which country does X border' needs real grammar; skip. 'did' with a known verb is fine.
        d = re.match(r"^(.+?) did (.+)$", rest)
        if d and len(d.group(1).split()) <= 5:
            words = d.group(2).split()
            for i, w in enumerate(words):
                if i and PAST.get(w):
                    return " ".join(words[:i] + [PAST[w]] + ["this", d.group(1)] + words[i + 1:]) if i == len(words) - 1 else None
            return None
        if re.search(rf"\b{AUX}\b", rest):
            return None
        # 'What color is the sky' -> 'The sky is this color'; 'Which planet is known as ...' stays in place
        s = re.match(rf"^(.+?) ({BE}) (.+)$", rest)
        if s and len(s.group(1).split()) <= 5:
            first = s.group(3).split()[0]
            subjecty = first.lower() in ("the", "a", "an", "his", "her", "their", "its") or first[:1].isupper() or first[:1] in "\"'“"
            superl = re.match(r"^the (most|only|first|last|second|third|largest|smallest|oldest|longest|highest|closest|best|main|\w+est)\b", s.group(3))
            if subjecty and not superl:
                if any(w.islower() and is_part(w) for w in s.group(3).split()[1:]):
                    return None
                return split_participle(s.group(3), s.group(2)) + f" this {s.group(1)}"
        if re.match(r"^(two|three|four|five|six|seven|eight|nine|ten|\d+) ", rest):
            return f"These {rest}"
        return f"This {rest}"

    # wh-word late in the sentence with only a noun phrase after it:
    # 'Broome is a town in which state of Australia' -> '... in this state of Australia'
    hits = list(re.finditer(r"\b(what|which)\b", q))
    if len(hits) == 1 and not re.search(r"\b(who|whom|whose|how|where|when|why)\b", q, re.I):
        tail = q[hits[0].end():]
        if tail.strip() and not re.search(rf"\b({BE}|{AUX}|be|been)\b", tail):
            return q[:hits[0].start()] + "this" + tail
    return None


def tidy(s):
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("“", '"').replace("”", '"').replace("’", "'")
    return s


def reword(question, answer):
    q, a = tidy(question), tidy(answer).rstrip(".")
    if q.count("?") != 1 or not q.endswith("?") or EXCLUDE.search(q) or not (0 < len(a) <= 60) or len(q) > 190:
        return None
    if len(a) > 3 and a.lower() in q.lower():
        return None
    if re.search(r"\b(all|none|both) of\b", a, re.I):
        return None
    body = q[:-1].rstrip()
    clue = core(body, bool(re.fullmatch(r"\d{3,4}( (AD|BC|BCE|CE))?", a)))
    if not clue or len(clue) < 25:
        return None
    clue = cap(tidy(clue))
    clue += "" if clue.endswith((".", "!", '."')) else "."
    person = re.match(r"^(Who|Whom)\b", body) or re.search(rf"\b(?:[Ww]hat|[Ww]hich|who) (?:\S+ ){{0,3}}(?:{PERSON_NOUNS})\b", body, re.I) \
        or " who " in f" {body.lower()} "
    lead = "Who is" if person and not re.fullmatch(r"[\d,.\s]+", a) else "What is"
    if re.match(r"^(Who|What) (are|were)\b", body) or clue.startswith("These "):
        lead = lead.replace(" is", " are")
    return clue, f"{lead} {a}" + ("" if a.endswith(("?", "!")) else "?")


def load(path):
    with open(path) as f:
        raw = json.load(f)
    return [{k: unquote(v) if isinstance(v, str) else v for k, v in q.items()} for q in raw]


def build(path):
    cats, rows, seen, total = {}, [], set(), 0
    for q in load(path):
        if q["type"] != "multiple":
            continue
        total += 1
        out = reword(q["question"], q["correct_answer"])
        if not out or out[0] in seen:
            continue
        seen.add(out[0])
        rows.append((q["category"], DIFF[q["difficulty"]], out[0], out[1]))
    counts = {}
    for r in rows:
        counts[r[0]] = counts.get(r[0], 0) + 1
    names = sorted(c for c, n in counts.items() if n >= MIN_PER_CATEGORY)
    idx = {c: i for i, c in enumerate(names)}
    clues = [[idx[c], d, clue, ans] for c, d, clue, ans in rows if c in idx]
    with open(os.path.join(HERE, "clues.js"), "w") as f:
        f.write("// Generated by build_bank.py. Adapted from the Open Trivia Database (opentdb.com), CC BY-SA 4.0.\n")
        f.write("window.CLUE_BANK = " + json.dumps({"cats": names, "clues": clues}, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"{len(clues)} clues kept of {total} multiple-choice questions, {len(names)} categories")
    for c in names:
        print(f"  {counts[c]:4d}  {c}")


def sample(path):
    random.seed()
    done = [(q, reword(q["question"], q["correct_answer"])) for q in load(path) if q["type"] == "multiple"]
    for q, out in random.sample([d for d in done if d[1]], 60):
        print(f"Q: {q['question']}\n   {out[0]}  ->  {out[1]}")


def fetch(path):
    def get(url):
        for i in range(6):
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    return json.load(r)
            except Exception as e:  # rate limit or network blip
                print("retry:", e, flush=True)
                time.sleep(6 + 4 * i)
        raise SystemExit("failed: " + url)

    token = get(f"{API}/api_token.php?command=request")["token"]
    out, amount = [], 50
    while True:
        time.sleep(5.3)  # the API allows one request per 5 seconds
        d = get(f"{API}/api.php?amount={amount}&token={token}&encode=url3986")
        code = d["response_code"]
        if code == 0:
            out += d["results"]
            print(len(out), flush=True)
            with open(path, "w") as f:
                json.dump(out, f)
        elif code == 5:
            time.sleep(6)
        elif code in (1, 4):  # fewer than `amount` left for this token
            if amount == 1:
                break
            amount = max(1, amount // 2)
        else:
            raise SystemExit(f"API error code {code}")
    print("done:", len(out))


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("fetch", "build", "sample"):
        raise SystemExit(__doc__)
    {"fetch": fetch, "build": build, "sample": sample}[sys.argv[1]](sys.argv[2])
