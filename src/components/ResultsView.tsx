// src/components/ResultsView.tsx
import React from "react";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Stack,
  Divider,
} from "@mui/material";
import type { Solution } from "../types";

type Props = {
  solutions: Solution[];
};

export default function ResultsView({ solutions }: Props) {
  if (!solutions || solutions.length === 0) {
    return (
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          Suggested lineups
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Upload a sheet and/or tweak filters to see suggested lineups here.
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={2}>
      {solutions.map((sol, i) => (
        <Paper key={i} sx={{ p: 2 }}>
          <Stack
            direction="row"
            alignItems="baseline"
            justifyContent="space-between"
          >
            <Typography variant="subtitle1">Lineup #{i + 1}</Typography>
            <Typography variant="body2" color="text.secondary">
              Total ${Number(sol.total_price ?? 0).toFixed(2)} •{" "}
              {Number(sol.total_projection ?? 0).toFixed(2)} proj
            </Typography>
          </Stack>

          <Divider sx={{ my: 1 }} />

          <TableContainer>
            <Table size="small" aria-label={`lineup-${i}`}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 28 }}>#</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell sx={{ width: 64 }}>Pos</TableCell>
                  <TableCell align="right" sx={{ width: 80 }}>
                    Price
                  </TableCell>
                  <TableCell align="right" sx={{ width: 110 }}>
                    Projection
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(sol.players ?? []).map((p, idx) => (
                  <TableRow key={`${p.Name}-${idx}`}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell
                      sx={{
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        maxWidth: 220,
                      }}
                      title={p.Name}
                    >
                      {p.Name}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>
                      {p.Pos}
                    </TableCell>
                    <TableCell align="right">
                      ${Number(p.Price ?? 0).toFixed(0)}
                    </TableCell>
                    <TableCell align="right">
                      {Number(p.Projection ?? 0).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
                {(!sol.players || sol.players.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Box
                        sx={{
                          py: 1,
                          color: "text.secondary",
                          fontStyle: "italic",
                        }}
                      >
                        (No players in this lineup)
                      </Box>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ))}
    </Stack>
  );
}
