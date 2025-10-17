# Hackulator

A powerful web calculator built with Vite + React + TypeScript featuring natural language processing, percent logic, step-by-step explanations, history, and multiple themes.

## Features

### Core Math
- Basic operations: `+`, `-`, `*`, `/`, `(`, `)`, `.`
- Proper operator precedence
- Safe evaluation with error handling

### Percent Logic
- **Base +/- percent**: `200 + 10%` → `220` (treats as `200 + (200 * 10 / 100)`)
- **Base - percent**: `200 - 15%` → `170`
- **Standalone percent**: `15%` becomes `(15 / 100)`

### Natural Language Processing
- **Percent of**: `15% of 42` → `15% * 42`
- **Add percent**: `add 10% to 200` → `200 + 10%`
- **Subtract percent**: `subtract 10% from 200` → `200 - 10%`
- **Time phrases**: `2 hours + 30 mins` → `(2*60) + 30`

### UI Features
- **Step-by-step explanations**: Shows conversion steps and final evaluation
- **History**: Stores last 30 computations with timestamps
- **Hotkeys**: 
  - `Enter` = equals
  - `Backspace` = delete
  - `Alt+S` = toggle steps
- **Themes**: Light / Dark / CRT (with scanlines overlay)
- **Responsive design**: Works on desktop and mobile

## Quick Tests

Try these expressions in the calculator:

- `200 + 10%` → `= 220`
- `200 - 15%` → `= 170`
- `15% of 42` → `= 6.3`
- `add 10% to 250` → `= 275`
- `subtract 20% from 80` → `= 64`
- `(2 hours + 30 mins) * 2` → `= 300`

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Architecture

- **Zero external math libraries** - Custom evaluator with safe execution
- **Natural language processing** - Regex-based text transformation
- **Theme system** - CSS classes for Light/Dark/CRT modes
- **History management** - Local state with timestamp tracking
- **Hotkey system** - Global keyboard event handling

## Technologies

- **Vite** - Fast build tool and dev server
- **React 18** - UI framework with hooks
- **TypeScript** - Type safety and better DX
- **CSS** - Custom styling with theme support
- **No external dependencies** - Pure JavaScript evaluation

## Try it out 
https://aglowns.github.io/Hackulator-Hackathon/
