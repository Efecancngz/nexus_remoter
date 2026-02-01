import os

def find_installed_app(search_term):
    """
    Scans Windows Start Menu for .lnk files matching the search term.
    Returns absolute path to the .lnk file or None.
    """
    search_term = search_term.lower().replace(" ", "")
    
    # Windows Start Menu locations
    paths = [
        os.path.join(os.environ["ProgramData"], r"Microsoft\Windows\Start Menu\Programs"),
        os.path.join(os.environ["APPDATA"], r"Microsoft\Windows\Start Menu\Programs")
    ]
    
    found_candidates = []
    
    for path in paths:
        if not os.path.exists(path): continue
        
        for root, dirs, files in os.walk(path):
            for file in files:
                if file.endswith(".lnk"):
                    file_name = file.lower().replace(" ", "").replace(".lnk", "")
                    
                    if search_term == file_name:
                        return os.path.join(root, file)
                    
                    if search_term in file_name:
                        found_candidates.append(os.path.join(root, file))
    
    # Return best match (shortest filename usually implies exact app name)
    if found_candidates:
        found_candidates.sort(key=lambda x: len(os.path.basename(x)))
        return found_candidates[0]
        
    return None
