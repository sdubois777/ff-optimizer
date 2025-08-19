# app.py
import logging
from typing import Any, Dict, List, Tuple, Optional
from collections import defaultdict

from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)
socketio = SocketIO(app, cors_allowed_origins="*")

# ---------- parsing ----------
def parse_rows(payload_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for r in payload_rows or []:
        name = str(r.get("Name") or r.get("name") or "").strip()
        pos = str(r.get("Pos") or r.get("position") or "").strip().upper()
        try:
            price = float(r.get("Price"))
        except Exception:
            price = 0.0
        try:
            proj = float(r.get("Projection"))
        except Exception:
            proj = 0.0
        anchor = bool(r.get("anchor", False))
        exclude = bool(r.get("exclude", False))
        if not name or not pos:
            continue
        rows.append(
            {
                "Name": name,
                "Pos": pos,
                "Price": max(0.0, price),
                "Projection": max(0.0, proj),
                "anchor": anchor,
                "exclude": exclude,
            }
        )
    return rows

def make_solution_payload(players: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "players": [
            {
                "Name": p["Name"],
                "Pos": p["Pos"],
                "Price": float(p["Price"]),
                "Projection": float(p["Projection"]),
                "anchor": bool(p.get("anchor", False)),
                "exclude": bool(p.get("exclude", False)),
            }
            for p in players
        ],
        "total_price": round(sum(float(p["Price"]) for p in players), 2),
        "total_projection": round(sum(float(p["Projection"]) for p in players), 4),
    }

# ---------- slot-aware solver ----------
DEFAULT_ROSTER: Dict[str, int] = {
    "QB": 1,
    "RB": 2,
    "WR": 2,
    "TE": 1,
    "FLEX": 1,   # RB/WR/TE
    "K": 0,
    "DST": 0,
}
FLEX_POS = {"RB", "WR", "TE"}
Slot = Dict[str, Any]

def _build_slots(roster: Dict[str, int]) -> List[Slot]:
    """Create exactly the number of slots requested (no double-counting)."""
    slots: List[Slot] = []
    for t in ["QB", "RB", "WR", "TE", "K", "DST"]:
        for _ in range(max(0, int(roster.get(t, 0)))):
            slots.append({"type": t, "player": None})
    for _ in range(max(0, int(roster.get("FLEX", 0)))):
        slots.append({"type": "FLEX", "player": None})
    return slots

def _slot_allows(slot_type: str, pos: str) -> bool:
    if slot_type == "FLEX":
        return pos in FLEX_POS
    return slot_type == pos

def _assign_anchor(slots: List[Slot], player: Dict[str, Any]) -> bool:
    # base slot first
    for s in slots:
        if s["player"] is None and s["type"] != "FLEX" and _slot_allows(s["type"], player["Pos"]):
            s["player"] = player
            return True
    # then FLEX
    for s in slots:
        if s["player"] is None and s["type"] == "FLEX" and _slot_allows("FLEX", player["Pos"]):
            s["player"] = player
            return True
    return False

def _seed_cheapest_slots(
    pool: List[Dict[str, Any]],
    anchors: List[Dict[str, Any]],
    roster: Dict[str, int],
) -> Tuple[List[Slot], float]:
    slots = _build_slots(roster)
    chosen = set()
    spent = 0.0

    # place anchors
    for a in anchors:
        if _assign_anchor(slots, a):
            chosen.add(a["Name"])
            spent += a["Price"]

    # fill remaining
    for s in slots:
        if s["player"] is not None:
            continue
        cands = [r for r in pool if r["Name"] not in chosen and _slot_allows(s["type"], r["Pos"])]
        cands.sort(key=lambda r: (r["Price"], -r["Projection"]))
        if cands:
            pick = cands[0]
            s["player"] = pick
            chosen.add(pick["Name"])
            spent += pick["Price"]

    return slots, spent

def _slots_players(slots: List[Slot]) -> List[Dict[str, Any]]:
    return [s["player"] for s in slots if s["player"] is not None]

def _slots_spent(slots: List[Slot]) -> float:
    return sum((s["player"] or {}).get("Price", 0.0) for s in slots)

def _improve_slots_within_budget(
    pool: List[Dict[str, Any]],
    slots: List[Slot],
    budget: float,
    anchors: List[Dict[str, Any]],
) -> List[Slot]:
    """Improve projection while respecting slot compatibility and staying <= budget.
       Anchored players are LOCKED and will not be swapped out."""
    slots = [dict(s) for s in slots]  # shallow copy
    anchor_names = {a["Name"] for a in anchors}
    chosen_names = {p["Name"] for p in _slots_players(slots)}
    spent = _slots_spent(slots)

    # If over budget, replace expensive non-anchors with cheaper slot-compatible picks
    for _ in range(200):
        if spent <= budget:
            break
        best = None  # (saving, slot_index, rep)
        for i, s in enumerate(slots):
            cur = s["player"]
            if not cur or cur["Name"] in anchor_names:
                continue
            cands = [
                r for r in pool
                if r["Name"] not in chosen_names
                and _slot_allows(s["type"], r["Pos"])
                and r["Price"] < cur["Price"]
            ]
            if not cands:
                continue
            cands.sort(key=lambda r: (cur["Price"] - r["Price"], r["Projection"]), reverse=True)
            rep = cands[0]
            saving = cur["Price"] - rep["Price"]
            if best is None or saving > best[0]:
                best = (saving, i, rep)
        if best is None:
            break
        _, i, rep = best
        chosen_names.remove(slots[i]["player"]["Name"])
        chosen_names.add(rep["Name"])
        spent += rep["Price"] - slots[i]["player"]["Price"]
        slots[i]["player"] = rep

    # Upgrade loop: improve projection but NEVER swap out anchors
    for _ in range(600):
        budget_left = budget - spent
        if budget_left <= 1e-9:
            break
        best = None  # (ratio, slot_index, rep)
        for i, s in enumerate(slots):
            cur = s["player"]
            if not cur or cur["Name"] in anchor_names:
                continue  # <-- lock anchors here
            cands = [
                r for r in pool
                if r["Name"] not in chosen_names
                and _slot_allows(s["type"], r["Pos"])
                and r["Projection"] > cur["Projection"]
                and (r["Price"] - cur["Price"]) > 0
                and (r["Price"] - cur["Price"]) <= budget_left
            ]
            for r in cands:
                gain = r["Projection"] - cur["Projection"]
                extra = r["Price"] - cur["Price"]
                ratio = gain / extra if extra > 0 else 0
                if best is None or ratio > best[0]:
                    best = (ratio, i, r)
        if best is None:
            break
        _, i, rep = best
        chosen_names.remove(slots[i]["player"]["Name"])
        chosen_names.add(rep["Name"])
        spent += rep["Price"] - slots[i]["player"]["Price"]
        slots[i]["player"] = rep

    return slots

def _candidates_by_slot(pool: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    by: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in pool:
        by[r["Pos"]].append(r)          # base slots
        if r["Pos"] in FLEX_POS:
            by["FLEX"].append(r)        # flex slot
    for lst in by.values():
        lst.sort(key=lambda r: r["Projection"], reverse=True)
    return by

def solve_lineups(
    rows: List[Dict[str, Any]],
    budget: float,
    k: int,
    roster: Optional[Dict[str, int]] = None,
) -> List[Dict[str, Any]]:
    roster = {**DEFAULT_ROSTER, **(roster or {})}
    pool = [r for r in rows if not r.get("exclude", False)]
    anchors = [r for r in pool if r.get("anchor", False)]

    # seed + improve
    seed_slots, _ = _seed_cheapest_slots(pool, anchors, roster)
    best_slots = _improve_slots_within_budget(pool, seed_slots, float(budget), anchors)

    results: List[Dict[str, Any]] = []
    def push(slots_obj: List[Slot]):
        players = _slots_players(slots_obj)
        payload = make_solution_payload(players)
        sig = tuple(sorted(p["Name"] for p in payload["players"]))
        if sig not in {tuple(sorted(p["Name"] for p in s["players"])) for s in results}:
            results.append(payload)

    push(best_slots)

    # diversify
    M = 12
    by_slot = _candidates_by_slot(pool)
    chosen_names = {p["Name"] for p in _slots_players(best_slots)}
    anchor_names = {a["Name"] for a in anchors}

    for i, s in enumerate(best_slots):
        cur = s["player"]
        if not cur or cur["Name"] in anchor_names:
            continue
        key = s["type"] if s["type"] != "FLEX" else "FLEX"
        alts = [r for r in by_slot.get(key, []) if r["Name"] not in chosen_names and r["Name"] != cur["Name"]]
        tried = 0
        for cand in alts:
            trial = [dict(x) for x in best_slots]
            trial[i] = {"type": s["type"], "player": cand}
            trial = _improve_slots_within_budget(pool, trial, float(budget), anchors)
            push(trial)
            tried += 1
            if len(results) >= max(1, int(k)) or tried >= M:
                break
        if len(results) >= max(1, int(k)):
            break

    results.sort(key=lambda s: s["total_projection"], reverse=True)
    return results[: max(1, int(k))]

# ---------- routes ----------
@app.get("/health")
def health():
    return jsonify({"ok": True})

@app.route("/draft-event", methods=["POST", "OPTIONS"])
def draft_event():
    if request.method == "OPTIONS":
        return ("", 204)
    data = request.get_json(silent=True) or {}
    app.logger.info("draft-event %s", data)
    socketio.emit("draft_event", data)
    return jsonify({"ok": True})

@app.post("/optimize")
def optimize():
    """
    JSON body:
    {
      "rows": [ {Name, Pos, Price, Projection, anchor?, exclude?}, ... ],
      "budget": 200,
      "k": 5,
      "roster": { "QB":1, "RB":2, "WR":2, "TE":1, "FLEX":1, "K":0, "DST":0 } // optional
    }
    """
    payload = request.get_json(silent=True) or {}
    rows = parse_rows(payload.get("rows") or [])
    budget = float(payload.get("budget") or 0)
    k = int(payload.get("k") or 1)
    roster = payload.get("roster") or None

    sols = solve_lineups(rows, budget, k, roster)
    return jsonify({
        "solutions": sols,
        "meta": {
            "budget": budget,
            "k": k,
            "num_candidates": len(rows),
            "roster": {**DEFAULT_ROSTER, **(roster or {})}
        }
    })

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    socketio.run(app, host="127.0.0.1", port=5001, debug=True)
