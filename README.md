# DABBOBA app-web prototype

모바일 브라우저와 앱 내 WebView를 고려한 React + TypeScript 프로토타입입니다. 현재 결제는 실제 PG 연동이 아닌 화면 흐름 확인용 모의 결제입니다.

## 로컬 실행

```bash
cd /Users/kyoungmin/Desktop/DBB/dabboba-app
npm install
npm run dev -- --port 4174
```

브라우저에서 [http://localhost:4174/](http://localhost:4174/)를 열면 됩니다.

## Expo Go 실행

최초 한 번 모바일 앱 의존성을 설치합니다.

```bash
npm --prefix apps/mobile install
```

컴퓨터와 휴대폰을 같은 Wi-Fi에 연결하고 터미널 두 개에서 실행합니다.

```bash
# 터미널 1: Expo Go가 불러올 웹앱
npm run dev:lan

# 터미널 2: Expo Go QR 서버
npm run mobile
```

두 번째 터미널의 QR 코드를 iPhone 카메라 또는 Android Expo Go로 스캔하면 됩니다. 로컬 실행에서는 Expo 서버의 LAN 주소를 자동으로 읽어 웹앱의 `4174` 포트로 연결합니다.

배포된 웹앱을 연결할 때는 `apps/mobile/.env.example`을 참고해 `EXPO_PUBLIC_DABBOBA_WEB_URL`에 HTTPS 주소를 설정합니다.

## 검증

```bash
npm run check:runtime
npm run build
npm run test:runtime
npm run test:sites
npm --prefix apps/mobile run typecheck
```
