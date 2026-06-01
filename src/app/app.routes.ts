import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: '',
		loadComponent: () => import('./sender-page/sender-page.component').then((module) => module.SenderPageComponent),
	},
	{
		path: 'receiver',
		loadComponent: () => import('./receiver-page/receiver-page.component').then((module) => module.ReceiverPageComponent),
	},
];
