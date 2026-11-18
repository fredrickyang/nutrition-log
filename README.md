# Nutrition Log

A small phone-first web app for logging daily meals and macros, built so a personal trainer can follow along.

- Log meals (breakfast, lunch, dinner, snacks) from a quick-add list of your usual foods, or type a one-off food.
- See calories, protein, carbs and fat against daily targets set by your trainer.
- Log body weight and a note for each day.
- See a 7-day view with a calorie chart, daily totals and averages.
- Send a day or week summary to WhatsApp (Indonesian or English).
- Give your trainer a **view-only link** that always shows the latest log.

Live at **https://fredrickyang.github.io/nutrition-log/**

## How it stores data

- Everything is saved on your phone first, so it works offline.
- When sync is connected, the log is also saved to one **secret GitHub Gist** (`nutrition-log.json`). The trainer link (`#view=<gist id>`) reads that gist.
- The access token and your trainer's phone number stay on your phone. They are never written to the gist or to this repo.
- Secret gists are unlisted, not private: anyone who has the trainer link can read the log. Only share it with your trainer.

## One-time setup (owner)

1. Create a GitHub **classic** token with only the **`gist`** permission: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token. Set an expiry you're comfortable with.
2. Open the setup link you were given (`…/nutrition-log/#setup=<gist id>`) on your phone. Paste the token in **Settings → Sync** and tap **Connect & sync**.
3. Add the app to your home screen (Safari: Share → Add to Home Screen; Chrome: ⋮ → Add to Home screen).
4. In **Settings → Trainer**, add your trainer's WhatsApp number (optional), then tap **Send link**.

## Development

Plain HTML, CSS and JavaScript. No build step and no dependencies. Serve the folder with any static server, e.g. `python3 -m http.server`.

## Backlog

- **Use official Indonesian food data for the quick-add list.** Replace or extend the approximate starter foods with values from **TKPI** (Tabel Komposisi Pangan Indonesia, published by Kemenkes RI). It has about 1,100 local ingredients and dishes, per 100 g.
  - Browse: [Panganku.org](https://www.panganku.org/en-EN/cari_nutrisi)
  - Cleaned CSV: [Kaggle: Indonesian Food and Drink Nutrition Dataset](https://www.kaggle.com/datasets/anasfikrihanif/indonesian-food-and-drink-nutrition-dataset)
  - Recipe-level data: [Mendeley: Indonesian culinary dataset](https://data.mendeley.com/datasets/8b4ztns76h)
  - Idea: add a "Search TKPI" option in the add-food sheet that picks per-100 g values, then asks for grams eaten. Check the dataset's licence before bundling it.
- **Packaged and restaurant foods.** FatSecret Indonesia has an API with local brands (Indomie, Ultra Milk) and chains. It needs API keys kept on a server, so it would need a small backend; not a fit for this static app as-is. Fumai is another local database to look at.
