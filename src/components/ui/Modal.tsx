import React from 'react';
// The one place react-native's Modal may be imported — see below.
// eslint-disable-next-line no-restricted-imports
import { Modal as NativeModal, ModalProps } from 'react-native';
import { useAppLocked } from '../../lib/appLock';

/**
 * react-native's Modal, hidden while the app is locked. A native Modal opens
 * in its own window above the whole app, so the biometric cover (which sits
 * over the still-mounted app, see lockView) cannot hide it: an open sheet
 * would show financial data above the lock screen and in the app-switcher
 * snapshot. The caller's `visible` is untouched, so the sheet reappears on
 * unlock.
 */
export function Modal({ visible, ...rest }: ModalProps) {
  const locked = useAppLocked();
  return <NativeModal {...rest} visible={!!visible && !locked} />;
}
