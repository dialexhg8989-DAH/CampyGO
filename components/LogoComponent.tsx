import React from 'react';

interface LogoComponentProps {
  size?: 'large' | 'medium' | 'small';
}

const LogoComponent: React.FC<LogoComponentProps> = ({ size = 'large' }) => {
  const dimensions = {
    large: { container: 'w-40 h-40' },
    medium: { container: 'w-24 h-24' },
    small: { container: 'w-12 h-12' }
  };
  const d = dimensions[size];
  
  return (
    <div className={`${d.container} mx-auto shadow-xl relative rounded-full overflow-hidden`}>
      <img 
        src="https://i.postimg.cc/dk64kmtV/campygo.png" 
        alt="CampyGo Logo" 
        className="w-full h-full object-cover" 
      />
    </div>
  );
};

export default LogoComponent;