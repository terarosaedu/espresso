# 에스프레소 베리에이션 실습 노트

교육생이 실습 피드백, 근태, 베스트 사진, 만족도 조사를 직접 기록하고
강사가 그 기록을 모아 평가표로 옮기는 웹앱.

- 교육생 화면: `index.html` (세로 폰 기준, 폴드폰 펼친 화면까지 대응)
- 강사 화면: `admin.html` (PC 권장)
- 데이터: Supabase (DB + 사진 저장소)
- 배포: GitHub Pages

## 파일 구성

```
index.html            교육생 화면
admin.html            강사 화면
css/style.css         디자인
js/config.js          Supabase 주소와 키 (직접 채워야 함)
js/common.js          세부 항목, 만족도 문항 등 공통 설정
js/student.js         교육생 화면 동작
js/admin.js           강사 화면 동작
assets/               로고, 예시 사진
supabase/schema.sql   DB 설정 (한 번만 실행)
```

## 처음 한 번 설정

1. **Supabase 프로젝트 준비**
   다른 Supabase 프로젝트가 있으면 같이 써도 됨. 모든 테이블에 `ev_` 접두어가 붙어 있어서 겹치지 않음.
   무료 플랜은 일주일 동안 DB 사용이 적으면 일시정지됨. 정지 약 일주일 전에 경고 메일이 오니,
   메일을 받으면 대시보드나 admin.html에 한 번 들어가면 됨. 정지돼도 데이터는 남아 있고 Resume project로 복구 가능.

2. **DB 만들기**
   SQL Editor에 `supabase/schema.sql` 전체를 붙여넣고 실행.

3. **익명 로그인 켜기**
   Authentication의 Sign In / Providers 설정에서 Anonymous sign-ins를 켬.
   교육생은 회원가입 없이 기수 코드와 이름으로 들어오고, 기기마다 익명 계정이 자동으로 만들어짐.

4. **접속 제한 늘리기 (중요)**
   Authentication의 Rate Limits에서 익명 로그인 제한이 기본 시간당 30회(IP 기준)임.
   교육장 와이파이 하나로 25명이 동시에 들어오면 막힐 수 있으니 넉넉하게(예: 200) 올려 둘 것.

5. **강사 계정 만들기**
   Authentication의 Users에서 Add user로 이메일과 비밀번호를 만들고(Auto confirm 체크),
   SQL Editor에서 이메일만 바꿔 실행:
   ```sql
   insert into public.ev_admins (user_id) select id from auth.users where email = '내이메일@terarosa.com';
   ```

6. **config.js 채우기**
   Project Settings의 API 메뉴에서 Project URL과 anon public key를 복사해 `js/config.js`에 넣음.
   anon key는 공개돼도 되는 키이고, 실제 보호는 schema.sql의 권한 설정이 맡음.

7. **GitHub에 올리고 Pages 켜기**

## 수업 운영

**수업 전**
admin.html에서 새 기수 만들기 → 기수 코드와 3일 날짜 입력.
교육생에게 사이트 주소와 기수 코드를 알려 줌 (QR로 띄우면 편함).

**수업 중 (교육생)**
- 매일 첫 화면에서 출석 또는 지각을 직접 체크. 누른 시각이 같이 저장됨.
- 피드백을 받을 때마다 에스프레소 / 카페라테 / 카푸치노 탭에서 항목을 고르고 내용을 적음.
- 고친 피드백은 "교정됨"으로 체크. 모아보기에서 연습 중인 것만 골라 볼 수 있음.

**3일차 (교육생)**
마무리 탭에서 피드백 돌아보기 → 라테·카푸치노 베스트 사진 첨부 → 만족도 조사 제출.
만족도 조사는 3일차부터 열림.

**수업 후 (강사)**
- 만족도·사진 미제출자는 상단 박스에 바로 표시됨.
- 근태·만족도 CSV: 엑셀로 열어서 평가표에 옮김.
- 사진 전체 ZIP: `기수_이름_카페라테.jpg` 형식으로 한 번에 내려받음.
- 총평 자료 전체 복사 → Claude에서 총평 스킬로 총평 작성.

## 알아 둘 것

- 같은 기수에서 같은 이름으로 들어오면 같은 사람으로 이어짐. 폰을 바꿔도 기록이 이어지는 대신,
  동명이인이 있으면 한 명은 이름 뒤에 구분자를 붙여 들어오게 해야 함 (예: 김민지B).
- 근태를 잘못 눌렀으면 Supabase Table Editor의 `ev_attendance`에서 직접 고치면 됨.
- 사진은 올릴 때 긴 변 1600px JPG로 줄여서 저장됨 (장당 수백 KB).
- 세부 항목이나 만족도 문항을 바꾸려면 `js/common.js` 위쪽만 고치면 됨.
- 카푸치노 예시 사진은 받은 파일 해상도가 작아서(149×180) 폰에서 흐릿하게 보임.
  더 큰 사진으로 `assets/sample-cappuccino.jpg`를 같은 이름으로 바꾸면 됨.
