// The camera reader of the web (06 §3): `@zxing/browser`, loaded only when a scan opens so the app stays light.

export type StopScanner = () => void;

/**
 * Reads codes from the back camera into [video] and calls [onRead] with each decoded text, every ~100 ms while a
 * label is in view (so `ScanGate` sees it twice). The formats are Android's (`BarcodeScanner`): EAN-13, EAN-8,
 * UPC-A, UPC-E and Code 128. Rejects as `getUserMedia` does (`NotAllowedError`, `NotFoundError`…).
 */
export async function startScanner(
  video: HTMLVideoElement,
  onRead: (text: string) => void,
): Promise<StopScanner> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
      ],
    ],
  ]);
  const reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 100,
    delayBetweenScanSuccess: 100,
  });
  const controls = await reader.decodeFromConstraints(
    { video: { facingMode: 'environment' } },
    video,
    (result) => {
      if (result) onRead(result.getText());
    },
  );
  return () => controls.stop();
}

/** Whether this browser can open a camera at all (it needs HTTPS, or localhost). */
export function canScan(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}
