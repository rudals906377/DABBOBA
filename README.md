# DABBOBA app-web prototype

모바일 브라우저와 앱 내 WebView를 고려한 React + TypeScript 프로토타입입니다. 현재 결제는 실제 PG 연동이 아닌 화면 흐름 확인용 모의 결제입니다.

## 로컬 실행

```bash
cd /Users/kyoungmin/Desktop/DBB/dabboba-app
npm install
npm run dev -- --port 4174
```

브라우저에서 [http://localhost:4174/](http://localhost:4174/)를 열면 됩니다.

## 검증

```bash
npm run check:runtime
npm run build
npm run test:runtime
npm run test:sites
```
