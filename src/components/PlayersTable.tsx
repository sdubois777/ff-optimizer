import React, { useMemo, memo, useEffect, useRef, useState } from 'react';
import { type PlayerRow } from '../types';
import { Box, Checkbox, TextField } from '@mui/material';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';

type ViewRow = PlayerRow & { __idx?: number };

type Props = {
  rows: ViewRow[];                     // possibly filtered
  onEdit: (originalIndex: number, patch: Partial<PlayerRow>) => void;
  listHeight?: number;                 // px; default 560
  rowHeight?: number;                  // px; default 48
};

// widen columns so Name has room; if viewport is smaller, we'll scroll horizontally
const COLS = '84px 84px minmax(180px, clamp(240px, 28vw, 360px)) 72px 120px 140px';
const MIN_TABLE_WIDTH = 780; // px; tweak as you like

const headerCell: React.CSSProperties = {
  fontWeight: 600,
  padding: '8px',
  textAlign: 'left',
  position: 'sticky',
  top: 0,
  background: '#111',
  zIndex: 2,
};

const RowRenderer = memo(function RowRenderer({
  index,
  style,
  data,
}: ListChildComponentProps<ViewRow[] & { onEdit: Props['onEdit'] }>) {
  const rows = data as any;
  const row: ViewRow = rows[index];
  const onEdit = rows.onEdit as Props['onEdit'];
  const original = row.__idx ?? index;

  const gridStyle: React.CSSProperties = {
    ...style,
    display: 'grid',
    gridTemplateColumns: COLS,
    alignItems: 'center',
    borderTop: '1px solid #333',
    padding: '0 8px',
    boxSizing: 'border-box',
    width: '100%',
  };

  const noWrapCell: React.CSSProperties = {
    padding: '6px 8px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <div style={gridStyle} key={`${row.Name}-${row.Pos}-${original}`}>
      <Checkbox
        size="small"
        checked={!!row.anchor}
        onChange={(e) => onEdit(original, { anchor: e.target.checked, exclude: e.target.checked ? false : row.exclude })}
      />
      <Checkbox
        size="small"
        checked={!!row.exclude}
        onChange={(e) => onEdit(original, { exclude: e.target.checked, anchor: e.target.checked ? false : row.anchor })}
      />
      <div style={noWrapCell} title={row.Name}>{row.Name}</div>
      <div style={noWrapCell} title={row.Pos}>{row.Pos}</div>
      <div style={{ padding: '6px 8px' }}>
        <TextField
          size="small"
          type="number"
          value={row.Price ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            const n = val === '' ? 0 : Math.trunc(Number(val));
            onEdit(original, { Price: Number.isFinite(n) && n >= 0 ? n : 0 });
          }}
          inputProps={{ min: 0, step: 1 }}
        />
      </div>
      <div style={{ padding: '6px 8px' }}>
        <TextField
          size="small"
          type="number"
          value={row.Projection ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            const n = val === '' ? 0 : Number(val);
            onEdit(original, { Projection: Number.isFinite(n) && n >= 0 ? n : 0 });
          }}
          inputProps={{ min: 0, step: '0.1' }}
        />
      </div>
    </div>
  );
});

export default function PlayersTable({
  rows,
  onEdit,
  listHeight = 560,
  rowHeight = 48,
}: Props) {
  // measure container so the list can be at least MIN_TABLE_WIDTH,
  // and grow when space allows (so names don't wrap)
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [contentWidth, setContentWidth] = useState<number>(MIN_TABLE_WIDTH);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setContentWidth(Math.max(MIN_TABLE_WIDTH, Math.floor(w)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const itemData = useMemo(() => {
    const d: any = [...rows];
    d.onEdit = onEdit;
    return d;
  }, [rows, onEdit]);

  return (
    <Box
      ref={outerRef}
      sx={{
        height: '100%',
        // horizontal scroll if viewport < MIN_TABLE_WIDTH
        overflowX: 'auto',
        // vertical scroll handled by react-window; avoid double scrollbars:
        overflowY: 'hidden',
      }}
    >
      {/* header + list share the same explicit width so columns align */}
      <div style={{ width: contentWidth }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            padding: '0 8px',
            boxSizing: 'border-box',
            position: 'sticky',
            top: 0,
            background: '#111',
            zIndex: 2,
            borderBottom: '1px solid #333',
          }}
        >
          <div style={headerCell}>Anchor</div>
          <div style={headerCell}>Exclude</div>
          <div style={headerCell}>Name</div>
          <div style={headerCell}>Pos</div>
          <div style={headerCell}>Price</div>
          <div style={headerCell}>Projection</div>
        </div>

        {/* Virtualized body */}
        <FixedSizeList
          height={listHeight}
          width={contentWidth}     // <- key: allow wide table; outer box will scroll if needed
          itemCount={rows.length}
          itemSize={rowHeight}
          itemData={itemData}
          itemKey={(idx, data) => {
            const r = (data as any)[idx] as ViewRow;
            return `${r.Name}-${r.Pos}-${r.__idx ?? idx}`;
          }}
          // let react-window handle vertical scrolling; horizontal is the outer Box
        >
          {RowRenderer as any}
        </FixedSizeList>
      </div>
    </Box>
  );
}
