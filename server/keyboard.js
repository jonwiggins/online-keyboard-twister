const KEYBOARD_LAYOUT = [
  [
    { code: 'Backquote', label: '`', assignable: true },
    { code: 'Digit1', label: '1', assignable: true },
    { code: 'Digit2', label: '2', assignable: true },
    { code: 'Digit3', label: '3', assignable: true },
    { code: 'Digit4', label: '4', assignable: true },
    { code: 'Digit5', label: '5', assignable: true },
    { code: 'Digit6', label: '6', assignable: true },
    { code: 'Digit7', label: '7', assignable: true },
    { code: 'Digit8', label: '8', assignable: true },
    { code: 'Digit9', label: '9', assignable: true },
    { code: 'Digit0', label: '0', assignable: true },
    { code: 'Minus', label: '-', assignable: true },
    { code: 'Equal', label: '=', assignable: true },
    { code: 'Backspace', label: '⌫', assignable: false }
  ],
  [
    { code: 'Tab', label: 'Tab', assignable: false },
    { code: 'KeyQ', label: 'Q', assignable: true },
    { code: 'KeyW', label: 'W', assignable: true },
    { code: 'KeyE', label: 'E', assignable: true },
    { code: 'KeyR', label: 'R', assignable: true },
    { code: 'KeyT', label: 'T', assignable: true },
    { code: 'KeyY', label: 'Y', assignable: true },
    { code: 'KeyU', label: 'U', assignable: true },
    { code: 'KeyI', label: 'I', assignable: true },
    { code: 'KeyO', label: 'O', assignable: true },
    { code: 'KeyP', label: 'P', assignable: true },
    { code: 'BracketLeft', label: '[', assignable: true },
    { code: 'BracketRight', label: ']', assignable: true },
    { code: 'Backslash', label: '\\', assignable: false }
  ],
  [
    { code: 'CapsLock', label: 'Caps', assignable: false },
    { code: 'KeyA', label: 'A', assignable: true },
    { code: 'KeyS', label: 'S', assignable: true },
    { code: 'KeyD', label: 'D', assignable: true },
    { code: 'KeyF', label: 'F', assignable: true },
    { code: 'KeyG', label: 'G', assignable: true },
    { code: 'KeyH', label: 'H', assignable: true },
    { code: 'KeyJ', label: 'J', assignable: true },
    { code: 'KeyK', label: 'K', assignable: true },
    { code: 'KeyL', label: 'L', assignable: true },
    { code: 'Semicolon', label: ';', assignable: true },
    { code: 'Quote', label: '\'', assignable: true },
    { code: 'Enter', label: 'Enter', assignable: false }
  ],
  [
    { code: 'ShiftLeft', label: 'Shift', assignable: false },
    { code: 'KeyZ', label: 'Z', assignable: true },
    { code: 'KeyX', label: 'X', assignable: true },
    { code: 'KeyC', label: 'C', assignable: true },
    { code: 'KeyV', label: 'V', assignable: true },
    { code: 'KeyB', label: 'B', assignable: true },
    { code: 'KeyN', label: 'N', assignable: true },
    { code: 'KeyM', label: 'M', assignable: true },
    { code: 'Comma', label: ',', assignable: true },
    { code: 'Period', label: '.', assignable: true },
    { code: 'Slash', label: '/', assignable: true },
    { code: 'ShiftRight', label: 'Shift', assignable: false }
  ],
  [
    { code: 'Space', label: 'Space', assignable: false }
  ]
];

const FLAT_KEYS = KEYBOARD_LAYOUT.flat();

const ASSIGNABLE_CODES = FLAT_KEYS.filter((key) => key.assignable).map((key) => key.code);
const ALL_KEY_CODES = FLAT_KEYS.map((key) => key.code);

module.exports = {
  KEYBOARD_LAYOUT,
  ASSIGNABLE_CODES,
  ALL_KEY_CODES
};
