import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Globe, FileText, CheckSquare, Settings, GraduationCap, Zap, BookOpenCheck, Library, Lock, Shield } from 'lucide-react';

const Sidebar: React.FC = () => {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
      isActive
        ? 'bg-accent text-white shadow-lg'
        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`;

  return (
    <div className="w-64 bg-primary h-full flex flex-col border-r border-slate-800 flex-shrink-0">
      <div className="p-6 flex items-center space-x-3 border-b border-slate-800">
        <div className="bg-gradient-to-br from-uni-red to-red-600 p-2 rounded-lg">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-white font-bold text-lg leading-tight">GrantFlow</h1>
          <p className="text-xs text-slate-400">University Admin</p>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        <NavLink to="/" className={navClass}>
          <LayoutDashboard className="w-5 h-5" />
          <span>Dashboard</span>
        </NavLink>
        
        {/* Renamed functionality: Scanner is now Find Funding */}
        <NavLink to="/find-funding" className={navClass}>
          <Zap className="w-5 h-5" />
          <span>Find Funding</span>
        </NavLink>

        {/* New functionality: Curated lists is now Open Calls */}
        <NavLink to="/open-calls" className={navClass}>
          <BookOpenCheck className="w-5 h-5" />
          <span>Open Calls</span>
        </NavLink>

        <NavLink to="/my-grants" className={navClass}>
          <FileText className="w-5 h-5" />
          <span>My Applications</span>
        </NavLink>
        
        <NavLink to="/tasks" className={navClass}>
          <CheckSquare className="w-5 h-5" />
          <span>Tasks & Todo</span>
        </NavLink>

        <NavLink to="/sources" className={navClass}>
          <Library className="w-5 h-5" />
          <span>Sources & Assets</span>
        </NavLink>

        {/* Separator for Admin Section */}
        <div className="pt-4 mt-4 border-t border-slate-800">
          <p className="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Central Oversight</p>
          <NavLink to="/admin" className={navClass}>
            <Shield className="w-5 h-5 text-uni-red" />
            <span>Admin Overview</span>
          </NavLink>
        </div>
      </nav>

      <div className="p-4 border-t border-slate-800">
        <button className="flex items-center space-x-3 px-4 py-3 w-full text-slate-400 hover:text-white transition-colors">
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;