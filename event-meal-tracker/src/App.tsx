import React, { useState, useEffect } from 'react';
import { StorageService } from './services/storage';
import { exportMealRecordsToExcel } from './services/excelExport';
import { Navbar } from './components/Navbar';
import { ScannerView } from './components/ScannerView';
import { DashboardView } from './components/DashboardView';
import { ParticipantRegistry } from './components/ParticipantRegistry';
import { LoginModal } from './components/LoginModal';
import { VolunteerModal } from './components/VolunteerModal';
import { MealScheduleModal } from './components/MealScheduleModal';
import { AppUser, Meal } from './types';
import { CheckCircle2, Download, AlertCircle, X } from 'lucide-react';

export default function App() {
  // Ensure default data is initialized
  useEffect(() => {
    StorageService.init();
  }, []);

  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => StorageService.getCurrentUser());
  const [currentTab, setCurrentTab] = useState<'scanner' | 'dashboard' | 'participants'>('scanner');
  
  // Modals
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isVolunteerModalOpen, setIsVolunteerModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);

  // Active meal & time state
  const [meals, setMeals] = useState<Meal[]>(() => StorageService.getMeals());
  const [activeMeal, setActiveMeal] = useState<Meal | null>(() => StorageService.getActiveMeal());
  const [nextMeal, setNextMeal] = useState<Meal | null>(() => StorageService.getNextMeal());
  const [currentTimeString, setCurrentTimeString] = useState<string>(() => StorageService.getCurrentClockTime());
  const [isTimeOverridden, setIsTimeOverridden] = useState<boolean>(() => !!StorageService.getTimeOverride());

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Sync state whenever storage updates or every second for clock
  const refreshAppData = () => {
    setMeals(StorageService.getMeals());
    setActiveMeal(StorageService.getActiveMeal());
    setNextMeal(StorageService.getNextMeal());
    setCurrentTimeString(StorageService.getCurrentClockTime());
    setIsTimeOverridden(!!StorageService.getTimeOverride());
    setCurrentUser(StorageService.getCurrentUser());
  };

  useEffect(() => {
    refreshAppData();
    const unsub = StorageService.subscribe(refreshAppData);

    // Refresh clock every second
    const clockInterval = setInterval(() => {
      setCurrentTimeString(StorageService.getCurrentClockTime());
      setActiveMeal(StorageService.getActiveMeal());
      setNextMeal(StorageService.getNextMeal());
    }, 1000);

    return () => {
      unsub();
      clearInterval(clockInterval);
    };
  }, []);

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Excel export trigger (PRD 4.5 & Open Question 1)
  const handleExportExcel = () => {
    try {
      const res = exportMealRecordsToExcel();
      if (res.success) {
        showToast(`Excel downloaded: ${res.filename}`, 'success');
      }
    } catch (err) {
      console.error('Export error', err);
      showToast('Export failed. Please try again.', 'info');
    }
  };

  // Logout handler
  const handleLogout = () => {
    StorageService.setCurrentUser(null);
    setCurrentUser(null);
    setIsLoginModalOpen(true);
  };

  // Reset to default seed
  const handleResetData = () => {
    if (window.confirm('Reset all meal logs and participants to default seed data?')) {
      StorageService.resetToDefault();
      showToast('All meal records reset to default state.', 'info');
    }
  };

  // Direct simulate scan from participant badge
  const handleSimulateScanFromRegistry = (uid: number) => {
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return;
    }
    setCurrentTab('scanner');
    // Process the scan immediately in the scanner
    const result = StorageService.processScan(uid, currentUser.usn);
    if (result.status === 'SUCCESS') {
      showToast(`Meal logged for ${result.participant?.name}.`, 'success');
    } else {
      showToast(result.message, 'info');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-blue-500 selection:text-white">
      
      {/* Navigation Header */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        currentUser={currentUser}
        activeMeal={activeMeal}
        nextMeal={nextMeal}
        currentTimeString={currentTimeString}
        isTimeOverridden={isTimeOverridden}
        onOpenVolunteerModal={() => setIsVolunteerModalOpen(true)}
        onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
        onExportExcel={handleExportExcel}
        onLogout={handleLogout}
        onResetData={handleResetData}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {currentTab === 'scanner' && (
          <ScannerView
            currentUser={currentUser}
            activeMeal={activeMeal}
            onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
          />
        )}

        {currentTab === 'dashboard' && (
          <DashboardView
            activeMeal={activeMeal}
            meals={meals}
            currentTimeString={currentTimeString}
            onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
          />
        )}

        {currentTab === 'participants' && (
          <ParticipantRegistry
            onSimulateScan={handleSimulateScanFromRegistry}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500 print:hidden">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Event Meal Tracker • Volunteer Counter Station</span>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setIsScheduleModalOpen(true)}
              className="hover:text-slate-300 transition-colors"
            >
              Meal Windows ({meals.length})
            </button>
            <span>•</span>
            <button
              onClick={handleExportExcel}
              className="hover:text-blue-400 transition-colors"
            >
              Download Full Report (.xlsx)
            </button>
            <span>•</span>
            <button
              onClick={handleResetData}
              className="hover:text-amber-400 transition-colors"
            >
              Reset Seed Data
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <LoginModal
        isOpen={!currentUser || isLoginModalOpen}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setIsLoginModalOpen(false);
          showToast(`Welcome, ${user.name}.`, 'success');
        }}
      />

      <VolunteerModal
        isOpen={isVolunteerModalOpen}
        onClose={() => setIsVolunteerModalOpen(false)}
        onVolunteerAdded={() => {
          showToast('New volunteer account created successfully.', 'success');
        }}
      />

      <MealScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        meals={meals}
        onMealsUpdated={() => {
          refreshAppData();
          showToast('Meal schedule and clock updated.', 'info');
        }}
      />

      {/* Toast Banner */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-blue-500/50 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-3 text-xs animate-in slide-in-from-bottom-3">
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-cyan-400 shrink-0" />
          )}
          <span className="font-medium">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white ml-2"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

    </div>
  );
}
