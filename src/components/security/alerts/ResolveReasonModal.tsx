import React, { useState } from 'react';
import { Button, Group, Modal, Radio, Stack, Text, Textarea } from '@mantine/core';
import { LIMITS, validateReason } from './validate';

/** The only determinations the triage rules accept for a resolved close. */
export type ResolveDisposition = 'true_positive' | 'unknown';

const ResolveForm = ({ busy, onCancel, onConfirm }: { busy?: boolean; onCancel: () => void; onConfirm: (reason: string, disposition: ResolveDisposition) => void }) => {
  const [reason, setReason] = useState('');
  const [disposition, setDisposition] = useState<ResolveDisposition | null>(null);
  const [touched, setTouched] = useState(false);
  // The service requires a reason for a stated determination; an 'unknown' close may go without one.
  const error = disposition === 'unknown' && reason.trim() === '' ? null : validateReason(reason);
  return (
    <>
      <Text size="sm" mb="xs">Resolving closes the alert. Say what it was, so the next analyst can check the call. For a false positive or benign activity, use Mark as noise.</Text>
      <Radio.Group label="What is it?" required value={disposition ?? ''} onChange={(v) => setDisposition(v as ResolveDisposition)} mb="sm">
        <Stack gap={4} mt={4}>
          <Radio value="true_positive" label="True positive: a real threat, now handled" />
          <Radio value="unknown" label="Unknown: closed without a determination" />
        </Stack>
      </Radio.Group>
      <Textarea
        label={disposition === 'unknown' ? 'Reason (optional)' : 'Reason'}
        required={disposition !== 'unknown'}
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
        <Button disabled={error !== null || disposition === null} loading={busy} onClick={() => disposition && onConfirm(reason.trim(), disposition)}>Resolve</Button>
      </Group>
    </>
  );
};

/** Resolving closes alerts, which the service only accepts with a disposition (and a reason). The form is mounted only while open. */
const ResolveReasonModal = ({ opened, count, busy, onCancel, onConfirm }: {
  opened: boolean;
  count: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, disposition: ResolveDisposition) => void;
}) => (
  <Modal opened={opened} onClose={onCancel} title={`Resolve ${count} alert${count === 1 ? '' : 's'}`} returnFocus>
    <ResolveForm busy={busy} onCancel={onCancel} onConfirm={onConfirm} />
  </Modal>
);
export default ResolveReasonModal;
