import React, { useMemo } from "react";
import {
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import type { PlayerRow } from "../types";

type SortKey = "Name" | "Pos" | "Price" | "Projection" | "anchor" | "exclude";
type SortDir = "asc" | "desc";
type ViewRow = PlayerRow & { __idx: number };

export default function PlayersTable(props: {
  rows: ViewRow[];
  onEdit: (originalIndex: number, patch: Partial<PlayerRow>) => void;
  listHeight: number;
  rowHeight: number;
  sortKey: SortKey;
  sortDir: SortDir;
  onRequestSort: (key: SortKey) => void;
  highlightOriginalIndex?: number | null;
  highlightColor?: "green" | "yellow" | "red" | null;
}) {
  const {
    rows,
    onEdit,
    listHeight,
    rowHeight,
    sortKey,
    sortDir,
    onRequestSort,
    highlightOriginalIndex = null,
    highlightColor = null,
  } = props;

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (
      sortDir === "asc" ? (
        <ArrowUpwardIcon fontSize="small" />
      ) : (
        <ArrowDownwardIcon fontSize="small" />
      )
    ) : null;

  const borderColor = useMemo(() => {
    if (highlightColor === "green") return "#2e7d32";
    if (highlightColor === "yellow") return "#f9a825";
    if (highlightColor === "red") return "#c62828";
    return "transparent";
  }, [highlightColor]);

  const nameDisplay = (s: string) => s.replace(/\s*\(.*$/, ""); // purely visual

  return (
    <TableContainer
      sx={{
        maxHeight: listHeight,
        overflowY: "auto",
        bgcolor: "#0d0d0d",
      }}
    >
      <Table stickyHeader size="small" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 52, color: "#ddd" }}>
              <Tooltip title="Include (anchor)">
                <span>Inc</span>
              </Tooltip>
            </TableCell>
            <TableCell sx={{ width: 56, color: "#ddd" }}>
              <Tooltip title="Exclude">
                <span>Exc</span>
              </Tooltip>
            </TableCell>

            <TableCell
              sx={{ width: 280, color: "#ddd", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
              onClick={() => onRequestSort("Name")}
            >
              Name {sortIcon("Name")}
            </TableCell>
            <TableCell
              sx={{ width: 70, color: "#ddd", fontWeight: 600, cursor: "pointer" }}
              onClick={() => onRequestSort("Pos")}
            >
              Pos {sortIcon("Pos")}
            </TableCell>
            <TableCell
              sx={{ width: 90, color: "#ddd", fontWeight: 600, cursor: "pointer" }}
              onClick={() => onRequestSort("Price")}
            >
              Price {sortIcon("Price")}
            </TableCell>
            <TableCell
              sx={{ width: 120, color: "#ddd", fontWeight: 600, cursor: "pointer" }}
              onClick={() => onRequestSort("Projection")}
            >
              Projection {sortIcon("Projection")}
            </TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {rows.map((r) => {
            const isHighlighted = r.__idx === highlightOriginalIndex;

            return (
              <TableRow
                key={r.__idx}
                hover
                sx={{
                  height: rowHeight,
                  "&:not(:last-of-type)": { borderBottom: "1px solid #222" },
                  backgroundColor: isHighlighted ? "rgba(255,255,255,0.03)" : "transparent",
                }}
              >
                {/* anchor */}
                <TableCell sx={{ color: "#ddd" }}>
                  <Checkbox
                    size="small"
                    checked={!!r.anchor}
                    onChange={(e) =>
                      onEdit(r.__idx, {
                        anchor: e.target.checked,
                        exclude: e.target.checked ? false : r.exclude,
                      })
                    }
                  />
                </TableCell>

                {/* exclude */}
                <TableCell sx={{ color: "#ddd" }}>
                  <Checkbox
                    size="small"
                    checked={!!r.exclude}
                    onChange={(e) =>
                      onEdit(r.__idx, {
                        exclude: e.target.checked,
                        anchor: e.target.checked ? false : r.anchor,
                      })
                    }
                  />
                </TableCell>

                {/* name with visible left border when highlighted */}
                <TableCell
                  sx={{
                    color: "#eee",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    borderLeft: isHighlighted ? `4px solid ${borderColor}` : "4px solid transparent",
                  }}
                >
                  {nameDisplay(r.Name)}
                </TableCell>

                {/* pos */}
                <TableCell sx={{ color: "#ccc" }}>{r.Pos}</TableCell>

                {/* price (editable) */}
                <TableCell sx={{ color: "#ccc" }}>
                  <TextField
                    value={r.Price ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const num = v === "" ? undefined : Number(v);
                      onEdit(r.__idx, { Price: Number.isFinite(num) ? Number(num) : 0 });
                    }}
                    size="small"
                    type="number"
                    inputProps={{ min: 0, step: 1 }}
                    sx={{ width: 90 }}
                  />
                </TableCell>

                {/* projection (editable) */}
                <TableCell sx={{ color: "#ccc" }}>
                  <TextField
                    value={r.Projection ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const num = v === "" ? undefined : Number(v);
                      onEdit(r.__idx, { Projection: Number.isFinite(num) ? Number(num) : 0 });
                    }}
                    size="small"
                    type="number"
                    inputProps={{ step: 0.1 }}
                    sx={{ width: 120 }}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
