import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: 'AIzaSyC3DSpObS0rrHvbnP2-gH7RnalgcT9IkKs',
  authDomain: 'expense-tracker-d48fe.firebaseapp.com',
  databaseURL: 'https://expense-tracker-d48fe-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'expense-tracker-d48fe',
  storageBucket: 'expense-tracker-d48fe.firebasestorage.app',
  messagingSenderId: '328257666851',
  appId: '1:328257666851:web:e0e1488e7b1eeb110e9696',
  measurementId: 'G-K4Y31S1GG9',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const database = getDatabase(app)

isSupported().then((supported) => {
  if (supported) {
    getAnalytics(app)
  }
})
