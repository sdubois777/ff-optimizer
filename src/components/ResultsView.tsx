import { type Solution } from '../types';
import { Box, Paper, Typography } from '@mui/material';

type Props = {
  solutions: Solution[];
};

export default function ResultsView({ solutions }: Props) {
  if (!solutions?.length) {
    return (
      <Paper sx={{ p: 2, border: '1px solid #333', bgcolor: '#111' }}>
        <Typography variant="body2" color="text.secondary">No results yet.</Typography>
      </Paper>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {solutions.map((sol) => (
        <Paper key={sol.rank} sx={{ p: 2, border: '1px solid #333', bgcolor: '#111' }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Lineup #{sol.rank} • Cost ${sol.total_cost} • Proj {sol.total_points}
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Slot', 'Name', 'Pos', 'Price', 'Projection', 'PP$'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #333' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sol.table.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', borderTop: '1px solid #333' }}>{r.Slot}</td>
                    <td style={{ padding: '6px 8px', borderTop: '1px solid #333' }}>{r.Name}</td>
                    <td style={{ padding: '6px 8px', borderTop: '1px solid #333' }}>{r.Pos}</td>
                    <td style={{ padding: '6px 8px', borderTop: '1px solid #333' }}>${r.Price}</td>
                    <td style={{ padding: '6px 8px', borderTop: '1px solid #333' }}>{r.Projection}</td>
                    <td style={{ padding: '6px 8px', borderTop: '1px solid #333' }}>
                      {r['PP$'] !== undefined ? r['PP$'] : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </Paper>
      ))}
    </Box>
  );
}
