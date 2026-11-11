# UI dependencies — design task 02

Installed versions are pinned in package.json and package-lock.json. All pre-existing package versions are unchanged.

| Package | Version | License |
| --- | --- | --- |
| @radix-ui/react-dialog | 1.3.1 | MIT (WorkOS) |
| clsx | 2.1.1 | MIT (Luke Edwards) |
| tailwind-merge | 3.7.0 | MIT (Dany Castillo) |
| tailwindcss | 4.3.5 | MIT (Tailwind Labs) |
| @tailwindcss/vite | 4.3.5 | MIT (Tailwind Labs) |

Transitive dependencies and their versions/licenses are recorded in package-lock.json; original license texts are distributed with their npm packages.

Only Button, NativeSelect, and Radix Dialog are adapted from shadcn/ui; no Base UI or React Aria primitives are included. Unused variants, components, animations, icon packages, and slot support are omitted. Dialog uses the Radix primitive; Button and NativeSelect use native elements. Styling uses the project's semantic colors and 32 px controls.

Sources retrieved 2026-11-11:

- https://ui.shadcn.com/r/styles/new-york/dialog.json
- https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/button.tsx
- https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/native-select.tsx
- https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md

## shadcn/ui license (applies to src/components/ui)

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
