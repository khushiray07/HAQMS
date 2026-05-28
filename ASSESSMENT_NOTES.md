# HAQMS Internship Assignment Notes

## Setup Changes

- PostgreSQL Docker port was changed from `5432` to `5433` to avoid local PostgreSQL port conflicts.
- Backend port was changed from `5000` to `5001` because port `5000` was already used by macOS.
- Frontend API references were updated from `localhost:5000` to `localhost:5001`.

## Issues Identified and Fixed

### 1. SQL Injection in Doctor / Physician Search

**Issue:**  
The doctor search API used raw SQL string interpolation with `$queryRawUnsafe`.

Original vulnerable behavior:
- Input such as `' OR '1'='1` returned all doctor records.
- The route was directly inserting user input into SQL.

**Fix Implemented:**  
Replaced unsafe raw SQL with Prisma `findMany` using safe filters:

- `contains`
- `mode: "insensitive"`
- `encodeURIComponent` on frontend search query

**Files Changed:**
- `backend/src/routes/doctors.js`
- `frontend/src/app/dashboard/page.js`

**Verification:**  
After the fix:
- Searching `House` returns Dr. Gregory House.
- Searching `' OR '1'='1` returns no unrelated records.
- Removed `queryRawUnsafe`, `ILIKE`, and raw SQL debug logging from the doctor route.

---

### 2. Frontend Hook Order Crash in Dashboard

**Issue:**  
The dashboard had an early conditional return before all React hooks were called. This caused:

`React has detected a change in the order of Hooks called by Dashboard`

**Fix Implemented:**  
Moved conditional auth return after all hooks and initialized `activeTab` safely. Added auth guards so dashboard waits for user/token before rendering protected content.

**Files Changed:**
- `frontend/src/app/dashboard/page.js`

**Impact:**  
Dashboard now renders without React hook-order runtime crashes.

---

### 3. Unauthorized API Call Timing Issue

**Issue:**  
Dashboard API calls were firing before the auth token was restored from localStorage into React state. This caused:

`401 Unauthorized`

**Fix Implemented:**  
Updated dashboard effects to wait for both `user` and `token` before making protected API calls.

**Files Changed:**
- `frontend/src/app/dashboard/page.js`

**Impact:**  
Protected dashboard API calls now wait for a valid session token.

---

### 4. Frontend Security Messaging Updated

**Issue:**  
After fixing the backend SQL injection, the frontend still showed old text saying the search used raw SQL interpolation.

**Fix Implemented:**  
Updated the UI copy from vulnerability warning to secure search messaging.

**Impact:**  
Frontend now accurately reflects the fixed backend behavior.

## Remaining Known Issues

Due to time constraints, the following are known remaining areas for improvement:

- Patient deletion authorization should be strictly enforced on backend roles.
- Queue check-in token generation may still need stronger transaction/unique constraint handling.
- Patient medical history display should handle null values safely.
- Some frontend forms need stronger validation.
- Some API URLs should be fully moved to environment variables for production deployment.
- Additional automated tests should be added for auth, role access, and search security.

## Approach

I prioritized issues based on production risk. Security fixes were handled first, especially SQL injection. Then I fixed frontend runtime stability issues caused by hook ordering and auth timing. I also updated frontend messaging to match the new secure backend behavior.