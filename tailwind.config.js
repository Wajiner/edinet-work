/** @type {import('tailwindcss').Config} */
// public/css/tailwind.css を生成するための設定。
// 以前は cdn.tailwindcss.com（ブラウザ上で毎回CSSを生成するPlay CDN）を読み込んで
// いたが、本番利用は非推奨で表示速度にも影響するため、事前ビルドに切り替えた。
// ビルド方法は README の「CSSのビルド」を参照。
module.exports = {
  // index.html と、HTMLを組み立てている js/*.js の両方を走査対象にする
  // （企業詳細パネルなどはJS側の文字列としてのみクラス名が現れるため）。
  content: ['./public/index.html', './public/js/**/*.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Noto Sans JP"', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef4ff', 100: '#dbe7ff', 500: '#3d6bf0', 600: '#2f57d6', 700: '#274aad' }
      }
    }
  },
  plugins: []
};
