import { Participant, Meal, AppUser, MealLog } from '../types';

export const INITIAL_MEALS: Meal[] = [
  {
    id: 'meal_breakfast',
    name: 'Breakfast',
    startTime: '07:30',
    endTime: '10:30',
    description: 'South Indian & Continental Breakfast Buffet'
  },
  {
    id: 'meal_lunch',
    name: 'Lunch',
    startTime: '12:30',
    endTime: '15:30',
    description: 'Executive Lunch spread & Rice Bowls'
  },
  {
    id: 'meal_snacks',
    name: 'Snacks',
    startTime: '16:30',
    endTime: '18:30',
    description: 'Tea, Filter Coffee & Evening Refreshments'
  },
  {
    id: 'meal_dinner',
    name: 'Dinner',
    startTime: '19:30',
    endTime: '23:59',
    description: 'Deluxe Dinner Buffet & Desserts'
  }
];

export const INITIAL_USERS: AppUser[] = [
  {
    id: 'user_1',
    name: 'Pavan',
    usn: 'VOL001',
    passwordHash: 'eventpass',
    role: 'Student Chair',
    createdAt: new Date().toISOString()
  },
  {
    id: 'user_2',
    name: 'Nishita',
    usn: 'VOL002',
    passwordHash: 'eventpass',
    role: 'Student Vice-chair',
    createdAt: new Date().toISOString()
  },
  {
    id: 'user_3',
    name: 'Bhoomika',
    usn: 'VOL003',
    passwordHash: 'eventpass',
    role: 'Web Developer',
    createdAt: new Date().toISOString()
  },
  {
    id: 'user_4',
    name: 'Tanmayi',
    usn: 'VOL004',
    passwordHash: 'eventpass',
    role: 'Secretary',
    createdAt: new Date().toISOString()
  },
  {
    id: 'user_5',
    name: 'Gokul',
    usn: 'VOL005',
    passwordHash: 'Treasurer',
    role: 'Volunteer',
    createdAt: new Date().toISOString()
  },
  {
    id: 'user_6',
    name: 'Tanushree',
    usn: 'VOL006',
    passwordHash: 'Execom',
    role: 'Volunteer',
    createdAt: new Date().toISOString()
  }
];

export const INITIAL_PARTICIPANTS: Participant[] = [
 
];

// Provide some initial logs for Breakfast so reporting and dashboard show realistic activity
export const INITIAL_LOGS: MealLog[] = [
  {
    id: 'log_seed_1',
    participantUid: 1001,
    participantName: 'Pavan',
    team: 'Amnesiacs',
    mealId: 'meal_breakfast',
    mealName: 'Breakfast',
    scannedAt: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
    scannedByUsn: 'VOL001'
  },
  {
    id: 'log_seed_2',
    participantUid: 1002,
    participantName: 'Avaneesh',
    team: 'ForensIQ',
    mealId: 'meal_breakfast',
    mealName: 'Breakfast',
    scannedAt: new Date(Date.now() - 3600 * 1000 * 3.8).toISOString(),
    scannedByUsn: 'VOL001'
  },
  {
    id: 'log_seed_3',
    participantUid: 1007,
    participantName: 'Bhoomika',
    team: 'Amnesiacs',
    mealId: 'meal_breakfast',
    mealName: 'Breakfast',
    scannedAt: new Date(Date.now() - 3600 * 1000 * 3.5).toISOString(),
    scannedByUsn: 'VOL002'
  }
];
