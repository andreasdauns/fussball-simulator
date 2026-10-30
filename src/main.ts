/**
 * Einstieg der App: 2D-Testansicht mit der echten Simulations-Engine.
 */

import './styles.css';
import { simulateMatch } from './engine';
import { ViewerApp } from './ui/app';
import { loadTeams } from './ui/teams';

const root = document.getElementById('app');
if (root) {
  const { teams, demo } = loadTeams();
  const app = new ViewerApp(root, (home, away, seed) => simulateMatch(home, away, seed), teams, demo);
  app.start();
}
