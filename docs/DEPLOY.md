# Деплой и домен

## GitHub Pages (бесплатный адрес)
1. В репозитории: **Settings → Pages → Source: GitHub Actions**.
2. Смерджить ветку в `main` — workflow `.github/workflows/deploy.yml` проверит типы и тесты, соберёт игру и опубликует её.
3. Адрес: `https://damirloboda.github.io/spaceship-game/` (одним файлом: `…/roy.html`).

## Собственный домен
Домен покупается у регистратора (например, `roy-game.ru`, `roygame.io`); сам репозиторий купить его не может.
1. У регистратора создать DNS-записи: `CNAME www → damirloboda.github.io` и для корня A-записи GitHub Pages
   (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`).
2. Положить файл `public/CNAME` с одной строкой — именем домена (например `roy-game.ru`) и запушить.
3. В **Settings → Pages** указать домен и включить **Enforce HTTPS**.

Сборка использует относительные пути (`base: './'`), поэтому работает и в подпапке Pages, и на корне домена, и как один HTML-файл.

## Локально
```
npm install
npm run dev          # разработка
npm run build:single # dist/index.html и dist/roy.html (всё в одном файле)
npm test
```
