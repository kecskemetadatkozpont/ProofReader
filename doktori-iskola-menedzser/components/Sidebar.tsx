
import React from 'react';
import { LayoutDashboard, Users, Settings, GraduationCap, UserCheck, Briefcase, LogOut } from 'lucide-react';
import { ViewState, User, UserRole } from '../types';

interface SidebarProps {
  currentView: ViewState;
  onChangeView: (view: ViewState) => void;
  currentUser: User;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, currentUser, onLogout }) => {
  
  // Define menu items based on roles
  const getMenuItems = () => {
    const items = [];

    if (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.SUPERVISOR) {
       items.push({ id: 'DASHBOARD', label: 'Vezérlőpult', icon: LayoutDashboard });
       items.push({ id: 'STUDENT_LIST', label: currentUser.role === UserRole.SUPERVISOR ? 'Saját Hallgatók' : 'Hallgatók', icon: Users });
    }

    if (currentUser.role === UserRole.STUDENT) {
       items.push({ id: 'STUDENT_DETAIL', label: 'Saját Munkatér', icon: LayoutDashboard });
    }

    if (currentUser.role === UserRole.ADMIN) {
       items.push({ id: 'SUPERVISOR_LIST', label: 'Témavezetők', icon: UserCheck });
    }

    // Projects visible to everyone, but different actions available
    items.push({ id: 'PROJECTS', label: 'Kutatási Projektek', icon: Briefcase });

    return items;
  };

  const menuItems = getMenuItems();

  return (
    <div className="w-64 bg-slate-900 text-white min-h-screen flex flex-col fixed left-0 top-0 z-10">
      <div className="p-6 flex items-center gap-3 border-b border-slate-700">
        <div className="p-2 bg-blue-600 rounded-lg">
           <GraduationCap size={24} className="text-white" />
        </div>
        <div>
            <h1 className="font-bold text-lg leading-tight">PhD Manager</h1>
            <p className="text-xs text-slate-400">
               {currentUser.role === UserRole.ADMIN ? 'Adminisztráció' : 
                currentUser.role === UserRole.SUPERVISOR ? 'Témavezetői Portál' : 'Hallgatói Portál'}
            </p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => {
          const isActive = currentView === item.id || (item.id === 'STUDENT_LIST' && currentView === 'STUDENT_DETAIL' && currentUser.role !== UserRole.STUDENT);
          return (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id as ViewState)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-2">
        <button className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white transition-colors">
            <Settings size={20} />
            <span>Beállítások</span>
        </button>
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors rounded-lg"
        >
            <LogOut size={20} />
            <span>Kijelentkezés</span>
        </button>
      </div>
    </div>
  );
};
