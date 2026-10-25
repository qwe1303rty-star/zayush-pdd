import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { ApiError } from './lib/api';
import { useMe } from './lib/hooks';
import { RankUpProvider } from './components/RankUp';
import { ErrorState } from './components/ui';
import { Splash } from './pages/Splash';
import { Gate } from './pages/Gate';
import { Home } from './pages/Home';
import { Learn } from './pages/Learn';
import { Quiz } from './pages/Quiz';
import { ExamHome, ExamRun, ExamResult } from './pages/Exam';
import { Signs, SignDetail } from './pages/Signs';
import { Assistant } from './pages/Assistant';
import { Profile } from './pages/Profile';
import { Garage } from './pages/Garage';
import { Ranks } from './pages/Ranks';
import { Achievements } from './pages/Achievements';
import { Settings } from './pages/Settings';
import { Consent, DocPage, DocsList, PhoneVerify } from './pages/Legal';

const Admin = lazy(() => import('./pages/admin/Admin'));

export function App() {
  const { pathname } = useLocation();
  const isAdminRoute = pathname.startsWith('/admin');
  const me = useMe();
  const [minSplash, setMinSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setMinSplash(false), 900);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (isAdminRoute) {
    return (
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="/admin/*" element={<Admin />} />
        </Routes>
      </Suspense>
    );
  }

  if (me.isPending || minSplash) return <Splash progress={me.isPending ? 0.6 : 1} />;
  if (me.isError) {
    const err = me.error as ApiError;
    // 152-ФЗ: до согласия учётная запись не создаётся — показываем экран согласия
    if (err.code === 'CONSENT_REQUIRED') return <Consent />;
    // 149-ФЗ: подтверждение российского номера, если включено на сервере
    if (err.code === 'PHONE_REQUIRED') return <PhoneVerify />;
    return (
      <div className="min-h-dvh grid place-items-center px-6">
        <ErrorState message={err.message} onRetry={err.status === 401 ? undefined : () => me.refetch()} />
      </div>
    );
  }
  if (me.data.access.required && !me.data.access.passed) return <Gate />;

  return (
    <RankUpProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/quiz/:kind/:id?" element={<Quiz />} />
        <Route path="/exam" element={<ExamHome />} />
        <Route path="/exam/:id" element={<ExamRun />} />
        <Route path="/exam/:id/result" element={<ExamResult />} />
        <Route path="/signs" element={<Signs />} />
        <Route path="/signs/:code" element={<SignDetail />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/garage" element={<Garage />} />
        <Route path="/ranks" element={<Ranks />} />
        <Route path="/achievements" element={<Achievements />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/docs" element={<DocsList />} />
        <Route path="/docs/:slug" element={<DocPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </RankUpProvider>
  );
}
