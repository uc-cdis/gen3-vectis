import React from 'react';
import { Drawer } from '@mantine/core';
import type { EntitySeed } from '@/lib/vectis-kit/spec';
import { ExpandableText } from '@/lib/vectis-kit/ui/ExpandableText';
import { encodeEntity } from '../context';
import { EntityProfile } from '../entities/EntityProfile';

/** One drawer for every entity value in the console (SOC-PLAN.md 15.5). */
const EntityDrawer = ({ seed, onClose }: { seed: EntitySeed; onClose: () => void }) => (
  <Drawer opened onClose={onClose} title={<ExpandableText value={`${seed.type}: ${seed.value}`} previewChars={200} size="md" label="entity value" />} position="right" size="xl" aria-label="Entity details">
    <EntityProfile key={encodeEntity(seed)} seed={seed} />
  </Drawer>
);
export default EntityDrawer;
