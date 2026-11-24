# アイコンの制作記録

生成方法：内蔵 ImageGen（CLI/APIキー未使用）。

デザイン：重ねたブラウザウィンドウと青・緑の2ペインで、複数セッションと分割表示を表す。文字を使わず、Dockの小さな表示でも識別できる構成。

採用元画像：`icon-source-clean.png`。`icon.png` と `icon.icns` は macOS の sips / iconutil でサイズ・形式を変換した派生ファイル。

## 初回生成プロンプト

Use case: logo-brand. Asset type: production macOS Dock application icon for Multisession Browser, a developer testing browser with independently signed-in tabs and split views. Create one original, polished macOS app icon, square 1024 by 1024 composition, not a presentation or mockup. A softly beveled deep indigo rounded-square tile with authentic transparent canvas outside its rounded corners and about 8 percent transparent padding. Within the tile a bold simple emblem of two overlapping browser-window cards, the front window divided into two clean vertical panes representing isolated sessions. Blue and teal glass panes, a small warm orange session accent, restrained pearl-white window frame and short tab shapes at the top. Front-on orthographic view, crisp silhouette recognizable at 32px, tasteful dimensional glass/enamel shading and subtle highlights, balanced generous negative space. Fit the whole icon on canvas. Use the application's established indigo #6478ff and teal #24a88a palette. No words, no letters, no numbers, no watermark, no Electron atom, no Safari compass, no Chrome logo, no photoreal desk, no background scene, no giant diffuse shadow. This is a finished bitmap icon asset, with real alpha transparency around the rounded square.

## 調整プロンプト

Edit target: the attached generated macOS app icon. Preserve the existing icon design, overlapping browser-window shapes, buttons, blue/teal panes, orange tab, colors, gloss, composition and proportions exactly. Change only the outer edge and transparency: remove every detached blue speck, blue noise, stray pixel and fuzzy halo outside the indigo rounded-square tile. Give the tile a clean smooth antialiased rounded-square silhouette, surrounded by completely clean 100% alpha-transparent empty padding on all sides (about 8% of the square canvas). No shadow or decoration outside the tile. Do not add a background, checkerboard, text, objects, or change the internal emblem. Deliver a single centered square production app icon with true transparency.

