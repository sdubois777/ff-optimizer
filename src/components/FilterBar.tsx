import React from 'react';
import { Stack, ToggleButton, ToggleButtonGroup, TextField, IconButton, Tooltip } from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';

type Props = {
  posOptions: string[];
  selectedPositions: string[];
  setSelectedPositions: (vals: string[]) => void;
  search: string;
  setSearch: (s: string) => void;
  onClearAll?: () => void;
};

export default function FilterBar({
  posOptions,
  selectedPositions,
  setSelectedPositions,
  search,
  setSearch,
  onClearAll,
}: Props) {
  return (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
      <ToggleButtonGroup
        value={selectedPositions}
        onChange={(_, vals: string[]) => setSelectedPositions(vals)}
        aria-label="Position filter"
      >
        {posOptions.map((p) => (
          <ToggleButton key={p} value={p} aria-label={p} size="small">
            {p}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <TextField
        size="small"
        label="Search players"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        InputProps={{
          startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1 }} />,
          endAdornment: search ? (
            <Tooltip title="Clear search">
              <IconButton size="small" onClick={() => setSearch('')}>
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null,
        }}
        sx={{ minWidth: 220 }}
      />

      {onClearAll && (
        <Tooltip title="Clear filters">
          <IconButton onClick={onClearAll} size="small">
            <ClearIcon />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}
