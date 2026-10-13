import React, { useState } from 'react';
import { Button, Group, Modal, Radio, Stack, Text, Textarea } from '@mantine/core';
import { LIMITS, validateReason } from './validate';

/** The only determinations the triage rules accept for noise. */
type NoiseDisposition = 'false_positive' | 'benign';

const ReasonForm = ({ busy, onCancel, onConfirm }: { busy?: boolean; onCancel: () => void; onConfirm: (reason: string, disposition: NoiseDisposition) => void }) => {
  const [reason, setReason] = useState('');
  const [disposition, setDisposition] = useState<NoiseDisposition | null>(null);
  const [touched, setTouched] = useState(false);
  const error = validateReason(reason);
  return (
    <>
      <Text size="sm" mb="xs">Noise is hidden from the default alert list. Say why, so the next analyst can check the call.</Text>
      <Radio.Group label="What is it?" required value={disposition ?? ''} onChange={(v) => setDisposition(v as NoiseDisposition)} mb="sm">
        <Stack gap={4} mt={4}>
          <Radio value="false_positive" label="False positive: the detection was wrong" />
          <Radio value="benign" label="Benign: real activity, not a threat" />
        </Stack>
      </Radio.Group>
      <Textarea
        label="Reason"
        required
        data-autofocus
        rows={3}
        maxLength={LIMITS.reason}
        value={reason}
        onChange={(e) => setReason(e.currentTarget.value)}
        onBlur={() => setTouched(true)}
        error={touched && error ? error : undefined}
      />
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onCancel}>Cancel</Button>
        <Button color="gray" disabled={error !== null || disposition === null} loading={busy} onClick={() => disposition && onConfirm(reason.trim(), disposition)}>Mark as noise</Button>
      </Group>
    </>
  );
};

/**
 * Marking alerts as noise hides them from the default view, so the analyst must say why. The reason is checked
 * here and the confirm button stays disabled until it is valid. The form is mounted only while the modal is open,
 * so it always starts empty.
 */
const NoiseReasonModal = ({ opened, count, busy, onCancel, onConfirm }: {
  opened: boolean;
  count: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, disposition: NoiseDisposition) => void;
}) => (
  <Modal opened={opened} onClose={onCancel} title={`Mark ${count} alert${count === 1 ? '' : 's'} as noise`} returnFocus>
    <ReasonForm busy={busy} onCancel={onCancel} onConfirm={onConfirm} />
  </Modal>
);
export default NoiseReasonModal;
