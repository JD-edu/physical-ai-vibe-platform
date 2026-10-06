// Host test declarations only; the real APIs are provided by MakeCode.
declare enum SerialPin { P14, P15 }
declare enum BaudRate { BaudRate9600, BaudRate115200 }
declare enum Delimiters { NewLine }
declare namespace serial {
  function redirect(tx: SerialPin, rx: SerialPin, baud: BaudRate): void;
  function setRxBufferSize(size: number): void;
  function writeLine(text: string): void;
  function delimiters(delimiter: Delimiters): string;
  function onDataReceived(delimiter: string, handler: () => void): void;
  function readUntil(delimiter: string): string;
}
declare namespace basic { function pause(ms: number): void; function showString(text: string): void; function forever(handler: () => void): void; }
declare namespace input { function temperature(): number; }

declare enum AnalogPin { P0, P1, P2, P14, P15 }
declare namespace pins { function servoWritePin(pin: AnalogPin, angle: number): void; }
