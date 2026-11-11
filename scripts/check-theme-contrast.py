"""Measure the actual semantic color values in src/style.css (WCAG sRGB)."""
import json
import re
from pathlib import Path

css = (Path(__file__).resolve().parent.parent / "src/style.css").read_text()
light_block = css.split(":root {", 1)[1].split("}", 1)[0]
dark_block = css.split(':root[data-theme="dark"] {', 1)[1].split("}", 1)[0]
light = dict(re.findall(r"(--[\w-]+):\s*(#[a-f0-9]+)", light_block))
dark = {**light, **dict(re.findall(r"(--[\w-]+):\s*(#[a-f0-9]+)", dark_block))}


def luminance(color):
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels]
    return sum(v * w for v, w in zip(linear, (0.2126, 0.7152, 0.0722)))


def contrast(first, second):
    low, high = sorted((luminance(first), luminance(second)))
    return (high + 0.05) / (low + 0.05)


results = []
for theme, tokens in (("light", light), ("dark", dark)):
    pairs = [(foreground, background, minimum)
             for foreground, minimum in (("--text", 4.5), ("--muted", 4.5),
                                         ("--control-border", 3), ("--focus", 3), ("--alert", 4.5))
             for background in ("--window", "--panel", "--canvas", "--field", "--message", "--selected")]
    pairs += [("--primary-text", background, 4.5) for background in ("--accent", "--accent-hover")]
    for foreground, background, minimum in pairs:
        ratio = contrast(tokens[foreground], tokens[background])
        results.append({"theme": theme, "foreground": foreground, "background": background,
                        "ratio": round(ratio, 3), "minimum": minimum, "passed": ratio >= minimum})

print(json.dumps(results, indent=2))
raise SystemExit(0 if all(result["passed"] for result in results) else 1)
