
import argparse, re, pandas as pd, unicodedata
from typing import List
try:
    import pulp
except Exception as e:
    raise SystemExit("This strict Top-K version requires PuLP. Install with:  pip install pulp")

def normalize_name(s: str) -> str:
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = s.encode("ascii","ignore").decode("ascii")
    s = re.sub(r"\s+", " ", s).strip()
    return s.lower()

def simplify_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower()) if isinstance(s, str) else ""

def extract_pos(s: str):
    if not isinstance(s, str):
        return None
    m = re.search(r"\((?:[^()]*-\s*)?(QB|RB|WR|TE)\)", s)
    if m: return m.group(1)
    m = re.search(r"-\s*(QB|RB|WR|TE)\)?", s)
    return m.group(1) if m else None

def load_table(path: str, sheet: str = None) -> pd.DataFrame:
    if path.lower().endswith(".csv"):
        df = pd.read_csv(path)
    else:
        df = pd.read_excel(path, sheet_name=sheet or 0)
    cols = {c.lower().strip(): c for c in df.columns}
    player_col = next((cols[k] for k in ["player","name","player name"] if k in cols), df.columns[0])
    price_col  = next((cols[k] for k in ["price","cost","$"] if k in cols), None)
    proj_col   = next((cols[k] for k in ["projection","proj","points","ppr","projected"] if k in cols), None)
    pos_col    = next((cols[k] for k in ["pos","position"] if k in cols), None)
    out = df.copy()
    if price_col is None or proj_col is None:
        raise ValueError("Could not find Price/Projection columns.")
    out = out.rename(columns={player_col:"Player", price_col:"Price", proj_col:"Projection"})
    if pos_col: out = out.rename(columns={pos_col:"Pos"})
    if "Pos" not in out.columns:
        out["Pos"] = out["Player"].apply(extract_pos)
    out["Price"] = pd.to_numeric(out["Price"], errors="coerce")
    out["Projection"] = pd.to_numeric(out["Projection"], errors="coerce")
    out = out.dropna(subset=["Price","Projection","Pos"]).copy()
    out["Price"] = out["Price"].astype(int)
    out["Name"] = out["Player"].str.replace(r"\s*\([^)]*\)", "", regex=True)
    out["Name"] = out["Name"].str.replace(r"\s+[A-Z]{1,4}$", "", regex=True)
    out["Name"] = out["Name"].str.replace(r"[A-Z]{2,4}$", "", regex=True)
    out["Name"] = out["Name"].str.replace(r"\s+", " ", regex=True).str.strip()
    out["NameKey"] = out["Name"].apply(normalize_name)
    out["NameKeySimpl"] = out["NameKey"].apply(simplify_key)
    out = out.sort_values(["NameKey","Projection","Price"], ascending=[True, False, True])\
             .drop_duplicates(subset=["NameKey"], keep="first").reset_index(drop=True)
    return out[["Name","NameKey","NameKeySimpl","Pos","Price","Projection"]]

def apply_excludes(df: pd.DataFrame, excludes: List[str]) -> pd.DataFrame:
    if not excludes:
        return df.copy()
    terms = []
    for n in excludes:
        n = n.strip()
        if not n: continue
        if " " in n:
            terms.append(re.escape(n))
        else:
            terms.append(r"\b" + re.escape(n) + r"\b")
    pat = "|".join(terms)
    if not pat:
        return df.copy()
    return df[~df["Name"].str.contains(pat, case=False, na=False)].reset_index(drop=True)

def match_anchor_indices(df: pd.DataFrame, anchors: List[str]) -> List[List[int]]:
    groups = []
    for raw in anchors:
        a = simplify_key(normalize_name(raw.strip()))
        if not a:
            continue
        idxs = df.index[df["NameKeySimpl"].str.contains(a, na=False)].tolist()
        groups.append(idxs)
    return groups

def solve_top_k_strict(df: pd.DataFrame, budget: int=180, k: int=5, anchors: List[str]=None):
    idx = list(range(len(df)))
    pos = df["Pos"].tolist()
    price = df["Price"].tolist()
    proj = df["Projection"].tolist()

    anchor_groups = match_anchor_indices(df, anchors or [])
    if anchors:
        unmatched = [a for a,g in zip(anchors, anchor_groups) if len(g)==0]
        if unmatched:
            raise SystemExit(f"Anchors not found in data (check spelling): {', '.join(unmatched)}")

    solutions = []
    banned_sets = []

    for rep in range(k):
        prob = pulp.LpProblem(f"Optimal_{rep+1}", pulp.LpMaximize)
        x = {i: pulp.LpVariable(f"x_{i}", lowBound=0, upBound=1, cat="Binary") for i in idx}

        prob += pulp.lpSum(proj[i]*x[i] for i in idx)
        prob += pulp.lpSum(price[i]*x[i] for i in idx) <= budget
        prob += pulp.lpSum(x[i] for i in idx) == 7
        prob += pulp.lpSum(x[i] for i in idx if pos[i]=="QB") == 1
        prob += pulp.lpSum(x[i] for i in idx if pos[i]=="TE") >= 1
        prob += pulp.lpSum(x[i] for i in idx if pos[i]=="RB") >= 2
        prob += pulp.lpSum(x[i] for i in idx if pos[i]=="WR") >= 2

        for g in anchor_groups:
            if g:
                prob += pulp.lpSum(x[i] for i in g) >= 1

        for S in banned_sets:
            prob += pulp.lpSum(x[i] for i in S) <= 6

        prob.solve(pulp.PULP_CBC_CMD(msg=False))
        if pulp.LpStatus[prob.status] != "Optimal":
            break

        chosen = [i for i in idx if x[i].value() == 1]
        banned_sets.append(chosen)

        rows = df.iloc[chosen].copy()
        rows["PP$"] = (rows["Projection"]/rows["Price"]).round(2)

        qb = rows[rows.Pos=="QB"].sort_values("Projection", ascending=False).head(1).assign(Slot="QB")
        te = rows[rows.Pos=="TE"].sort_values("Projection", ascending=False).head(1).assign(Slot="TE")
        wr = rows[rows.Pos=="WR"].sort_values("Projection", ascending=False).head(2)
        rb = rows[rows.Pos=="RB"].sort_values("Projection", ascending=False).head(2)
        rem = rows.drop(pd.concat([qb,te,wr,rb]).index)
        flex = rem.sort_values("Projection", ascending=False).head(1).assign(Slot="FLEX")

        ordered = pd.concat([
            qb, rb.iloc[[0]].assign(Slot="RB1"), rb.iloc[[1]].assign(Slot="RB2"),
            wr.iloc[[0]].assign(Slot="WR1"), wr.iloc[[1]].assign(Slot="WR2"),
            te, flex
        ], ignore_index=True)[["Slot","Name","Pos","Price","Projection","PP$"]]

        solutions.append({
            "rank": rep+1,
            "total_cost": int(rows["Price"].sum()),
            "total_points": float(rows["Projection"].sum()),
            "table": ordered
        })
    return solutions

def main():
    ap = argparse.ArgumentParser(description="Strict Top-K optimizer with --anchor (requires PuLP).")
    ap.add_argument("path", help="Excel/CSV path")
    ap.add_argument("--sheet", default=None, help="Excel sheet name")
    ap.add_argument("--budget", type=int, default=180, help="Budget cap (default 180)")
    ap.add_argument("--k", type=int, default=5, help="How many lineups (default 5)")
    ap.add_argument("--exclude", default="", help="Comma-separated names to exclude")
    ap.add_argument("--anchor", default="", help="Comma-separated names that MUST appear (e.g., \"Ja'Marr Chase, Trey McBride\")")
    args = ap.parse_args()

    df = load_table(args.path, args.sheet)
    excludes = [s.strip() for s in args.exclude.split(",") if s.strip()]
    anchors  = [s.strip() for s in args.anchor.split(",") if s.strip()]
    df = apply_excludes(df, excludes)

    sols = solve_top_k_strict(df, budget=args.budget, k=args.k, anchors=anchors)
    if not sols:
        print("No feasible lineups found (anchors/excludes/budget may conflict).")
        return

    base = args.path.rsplit(".",1)[0]
    if anchors:
        print(f"\nAnchored to: {', '.join(anchors)}")
    for s in sols:
        print(f"\n=== Lineup #{s['rank']} | Cost ${s['total_cost']} | Proj {round(s['total_points'],2)} ===")
        print(s["table"].to_string(index=False))

    lines = []
    if anchors:
        lines.append(f"Anchored to: {', '.join(anchors)}")
        lines.append("")
    for s in sols:
        lines.append(f"=== Lineup #{s['rank']} | Cost ${s['total_cost']} | Proj {round(s['total_points'],2)} ===")
        lines.append(s["table"].to_string(index=False))
        lines.append("")
    txt = f"{base}_STRICT_top{len(sols)}_budget{args.budget}.txt"
    with open(txt, "w") as f:
        f.write("\n".join(lines))
    print(f"\nAll strict lineups saved to: {txt}")

if __name__ == "__main__":
    main()
