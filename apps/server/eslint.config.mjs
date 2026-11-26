import next from 'eslint-config-next';
import root from '../../eslint.config.mjs';

const config = [
  ...root,
  ...next,
  {
    rules: {
      // Intentional, hydration-safe patterns: reading localStorage after mount and copying props
      // into an editable draft. Kept visible as warnings instead of contorting those components.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  { ignores: ['.next/**', '.next-*/**', '*.nosync/**', 'next-env.d.ts'] },
];

export default config;
