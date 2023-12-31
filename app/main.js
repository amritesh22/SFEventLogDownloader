const { app, BrowserWindow, dialog, ipcMain, nativeTheme, Menu } = require('electron');
const path = require('path');
const util = require('util');
const fs = require('fs');
const fsPromise = require('fs').promises;
const axios = require('axios');
const exec = util.promisify(require('child_process').exec);
const xml2js = require('xml2js');
const os = require("os");

let mainWindow;
let doDownloading; //possible values are true or false
let API_VERSION = '58.0';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });  
  mainWindow.loadFile('app/index.html');
  Menu.setApplicationMenu(null);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', () => {
  nativeTheme.themeSource = 'dark';
  createWindow();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle('getorglist', () => {
  const orglist = getAuthenticatedOrgs();
  return orglist;
});
ipcMain.handle('downloadeventlogs', async (event, data) => {
  doDownloading = true;
  const result = await downloadEventLogFiles(data);
  if(result) {
    mainWindow.webContents.send('filedownloadcomplete');
    console.log('Download operation complete !');
  }  
});
ipcMain.handle('selectfolder', () => {
  return selectFolderOut();
});
ipcMain.handle('savesettings', (event, data) => {
  savesettingfile(data);
});
ipcMain.handle('readsettings', () => {
  const jsondata = readsettingfile();
  return jsondata;
});
ipcMain.handle('canceldownload', () => {
  doDownloading = false;
});


async function downloadEventLogFiles(data) {
  
  try {

    let access_token, instance_url;
    if(data.org) {
      const logindata = await getaccesstokenfromcli(data.org);
      access_token = logindata.accessToken;
      instance_url = logindata.instanceUrl;
    } else if(data.accesstoken && data.instanceurl) {
      access_token = data.accesstoken;
      instance_url = data.instanceurl;
    } else if(data.username && data.password && data.loginurl) {
      const logindata = await salesforcelogin(data.username , data.password, data.loginurl);
      access_token = logindata.accessToken;
      instance_url = logindata.instanceUrl;
    } else {
      throw new Error("Insufficient authorization details.");
    }
    
    console.log(`access_token: ${access_token}`);
    console.log(`instance_url: ${instance_url}`);

    if(!doDownloading) {
      //console.log('Operation cancelled by user');
      mainWindow.webContents.send('downloadcancelled');
      throw new Error('Operation cancelled by user');
    }
    
    let query = `SELECT Id, EventType, LogDate, LogFileLength, Interval, ApiVersion FROM EventLogFile WHERE Id!=null`;
    if (data.interval)  query += ` AND Interval='${data.interval}'`;
    else query += ` AND Interval IN ('Hourly', 'Daily')`;
    if (data.eventType) {
      let eventType = data.eventType.replaceAll(",", "','");
      query += ` AND EventType IN ('${eventType}')`;
    }
    if (data.startDate && data.endDate) query += ` AND LogDate>=${data.startDate}T00:00:00Z AND LogDate<=${data.endDate}T00:00:00Z`;
    
    query += ` ORDER BY LogDate,EventType`;
      
    /*let cmd = `sf data query -o ${data.org} -q "${query}" --json`;
    //console.log(`Event log query : ${query}`);
    console.log(`Command : ${cmd}`);      
    const { stdout, stderr } = await exec(cmd);         
    if (stderr) {
      dialog.showErrorBox('Error', stderr);
      return;
    }
    result = JSON.parse(stdout);*/

    console.log(`Event log query : ${query}`);
    let queryendpoint = instance_url+'/services/data/v'+API_VERSION+'/query?q=' + encodeURIComponent(query);
    let headr = {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    };
    const response = await axios.get(queryendpoint, { headers: headr });
    console.log(response.data.records.length);
    //const result = response.data;
    const records = response.data.records;
    if(!records || records.length==0) {
      console.log('No records found');
      dialog.showErrorBox('Info', 'No records found');
    }  
    else if(records.length>0) {

        mainWindow.webContents.send('filesfound', records.length);        

        let compress = 'yes';
        let headers;
        if (compress === 'y' || compress === 'yes') {
          headers = { 'Authorization': 'Bearer '+access_token, 'X-PrettyPrint': '1', 'Accept-encoding': 'gzip' };
          console.log('Using gzip compression\n');
        } else {
          headers = { 'Authorization': 'Bearer '+access_token, 'X-PrettyPrint': '1' };
          console.log('Not using gzip compression\n');
        }
        
        let mapRecordsByDate = {};
        
        //create speerate list for each day
        for(let record of records) {
          if(!mapRecordsByDate[record.LogDate.slice(0, 10)]) {
            mapRecordsByDate[record.LogDate.slice(0, 10)] = [];
          }
          mapRecordsByDate[record.LogDate.slice(0, 10)].push(record);
        }
        //console.log(mapRecordsByDate);
        let allapicalls = [];
        for(const recordlst of Object.values(mapRecordsByDate)) {          
          allapicalls.push(downloadFilefromList(recordlst, instance_url, headers, data)); 
        }
        const results = await Promise.all(allapicalls);
        return true;
    }  
  } catch(error){
    console.error(`Error: ${error}`);    
    if(error.message && error.message.includes('cancelled by user')) { }    
    else {
      mainWindow.webContents.send('downloadincomplete'); 
      dialog.showErrorBox('Error', error.message);
    }       
    return;
  }
}

async function getAuthenticatedOrgs(event) {
  try{
    const command = 'sf org list --json';
    const { stdout, stderr } = await exec(command);
    if(stdout) {
      const orgs = JSON.parse(stdout).result.nonScratchOrgs;      
      if(event) event.reply('orglist.response', orgs);
      else return orgs;
    }  
    if(stderr){ console.error(`stderr: ${stderr}`); }
  } catch(e) {
    console.error(e);
  }
}

function selectFolderOut() {
  let folderPath;
  try{
  const result = dialog.showOpenDialogSync({ properties: ['openDirectory']});
  if (!result.canceled) {
    folderPath = result[0];
    console.log(`Selected folder: ${folderPath}`);
  }
  }catch(err){
    console.error(`Error: ${err}`);
  }
  return folderPath;
}

async function getaccesstokenfromcli(org) {
  try{
    const { stdout, stderr } = await exec(`sf org display -o ${org} --json`, { encoding: 'utf-8' });
    if(stdout) {
      const data = JSON.parse(stdout);
      const accessToken = data.result.accessToken;
      const instanceUrl = data.result.instanceUrl;  
      return { accessToken, instanceUrl };
    }
    if(stderr){ console.error(`stderr: ${stderr}`); }
  } catch(e) {
    console.error(e);
  }
}

function getSettingsPath() {
  const userHomeDir = os.homedir();
  return userHomeDir+'/.electron/sfeventlogdownloader';
}

async function savesettingfile(data) {
  const filepath = getSettingsPath();
  if (!fs.existsSync(filepath)) {
    fs.mkdirSync(filepath, { recursive: true });
  }
  fs.writeFile(filepath+'/settings.json', data, (err) => {
    if (err) { console.error(`settings.json update failed: ${err}`); }
    else console.log('settings.json updated');
  });
}

async function readsettingfile() {
  try{
    const data = await fsPromise.readFile(getSettingsPath()+'/settings.json');     
    const jsonData = JSON.parse(data);
    return jsonData;    
  } catch(err) {
    console.error(`Error: ${err}`); 
  }
}

async function downloadFilefromList(records, instance_url, headers, data) {
    let results = [];
    for(let record of records){
      
      if(!doDownloading) {
        //console.log('Operation cancelled by user');
        mainWindow.webContents.send('downloadcancelled');
        throw new Error('Operation cancelled by user');
      }
      //console.log(record);
      const ids = record.Id;
      const types = record.EventType;
      const dates = record.LogDate;
      const interval = record.Interval;
      
      const url = instance_url+'/services/data/v'+API_VERSION+'/sobjects/EventLogFile/'+ids+'/LogFile';

      let slicelimit = 13;
      if(interval && interval=='Daily') slicelimit = 10;
      
      let filename = path.join(data.outputFolder, `${dates.slice(0, slicelimit)}-${types}.csv`);
      
      if(data.seperatefolder) {  
        let folder = path.join(data.outputFolder, `${dates.slice(0, 10)}`);
        if(interval && interval=='Daily') filename = path.join(folder, `${types}.csv`);
        else filename = path.join(folder, `${dates.slice(11, 13)}-${types}.csv`);
        if (!fs.existsSync(folder)) {
          fs.mkdirSync(folder, { recursive : true });
        }
      }
      results.push(await downloadFile(url, headers, filename));
      //mainWindow.webContents.send('filedownloadupdate');
    }
    return results;
}

async function downloadFile(url, headers, filename) {
  console.log(`Downloading ${filename}`);
  const response = await axios.get(url, { headers: headers, responseType: 'stream' });
  const writer = fs.createWriteStream(filename);

  return new Promise((resolve, reject) => {

    if (response.headers['content-encoding'] === 'gzip') {
      zlib.gunzip(response.data, (error, decompressedData) => {
        if (error) {
          console.error('Error decompressing the response:', error);
          reject();
        } else {
          decompressedData.data.pipe(writer);				
        }
      });
    } else {
      response.data.pipe(writer);
    }
    writer.on('finish', () => {
      mainWindow.webContents.send('filedownloadupdate');
      resolve();
    });
    writer.on('error', reject);

  });
}

async function salesforcelogin(username, password, baseurl) {

	const loginUrl = `https://${baseurl || 'login.salesforce.com'}/services/Soap/u/${API_VERSION}`;
  console.log(`loginUrl: ${loginUrl}`);
	const soapRequest = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">
	<soapenv:Body>
		<urn:login>
			<urn:username>${username}</urn:username>
			<urn:password>${password}</urn:password>
		</urn:login>
	</soapenv:Body>
  </soapenv:Envelope>`;

	const response = await axios.post(loginUrl, soapRequest, {
		headers: {
			"Content-Type": "text/xml; charset=UTF-8",
			"SOAPAction": "login",
			"Accept": "text/xml"
		}
	});
	// Convert the XML response to a JavaScript object
	const parsed = await xml2js.parseStringPromise(response.data); //, (err, response) => {
	const accessToken = parsed['soapenv:Envelope']['soapenv:Body'][0]['loginResponse'][0]['result'][0]['sessionId'][0];
  let instanceUrl = parsed['soapenv:Envelope']['soapenv:Body'][0]['loginResponse'][0]['result'][0]['serverUrl'][0];
  instanceUrl = instanceUrl.split('/services')[0];
	console.log('Access token:', accessToken);

  return { accessToken, instanceUrl }
}
