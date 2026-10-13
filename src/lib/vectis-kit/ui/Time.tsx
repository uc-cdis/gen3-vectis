import React from 'react';
import { Text, Tooltip } from '@mantine/core';
import { formatTime, relativeTime } from './format';

/** Relative time in the cell, absolute time in the tooltip and in the machine-readable attribute. */
const Time = ({ iso }: { iso: string | null | undefined }) => {
  if (!iso) return <Text span size="sm" c="dimmed">—</Text>;
  return (
    <Tooltip label={formatTime(iso)} withArrow>
      <Text component="time" dateTime={iso} size="sm">{relativeTime(iso)}</Text>
    </Tooltip>
  );
};
export default Time;
