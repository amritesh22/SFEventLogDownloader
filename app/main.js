const { app, BrowserWindow, dialog, ipcMain, nativeTheme, Menu } = require('electron');
const path = require('path');
const util = require('util');
const fs = require('fs');
const fsPromise = require('fs').promises;
const axios = require('axios');
const exec = util.promisify(require('child_process').exec);
const xml2js = require('xml2js');

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
  //Menu.setApplicationMenu(null);

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
  await downloadEventLogFiles(data);
  mainWindow.webContents.send('filedownloadcomplete');
  console.log('Download operation complete !');
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


async function downloadEventLogFiles(data) {
  
  try {

    let query = `SELECT Id, EventType, LogDate, LogFileLength, Interval, ApiVersion FROM EventLogFile WHERE Id!=null`;
    if (data.interval)  query += ` AND Interval='${data.interval}'`;
    else query += ` AND Interval IN ('Hourly', 'Daily')`;
    if (data.eventType) {
      let eventType = data.eventType.replaceAll(",", "','");
      query += ` AND EventType IN ('${eventType}')`;
    }
    if (data.startDate && data.endDate) query += ` AND LogDate>=${data.startDate}T00:00:00Z AND LogDate<=${data.endDate}T00:00:00Z`;
    
    query += ` ORDER BY LogDate,EventType`;
    let result;
    if(data.org) {
      let cmd = `sf data query -o ${data.org} -q "${query}" --json`;
      //console.log(`Event log query : ${query}`);
      console.log(`Command : ${cmd}`);      
      const { stdout, stderr } = await exec(cmd);         
      if (stderr) {
        dialog.showErrorBox('Error', stderr);
        return;
      }
      result = JSON.parse(stdout);
    }
    console.log(`Event log query : ${query}`);
    
    if(result && result.status === 0) {
      const records = result.result.records;
      if(!records || records.length==0) {
        console.log('No records found');
        dialog.showMessageBox('INFO ', 'No records found');
      }      
      else if(records.length>0) {

        mainWindow.webContents.send('filesfound', records.length);

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

        let compress = 'yes';
        let headers;
        if (compress === 'y' || compress === 'yes') {
          headers = { 'Authorization': 'Bearer '+access_token, 'X-PrettyPrint': '1', 'Accept-encoding': 'gzip' };
          console.log('Using gzip compression\n');
        } else {
          headers = { 'Authorization': 'Bearer '+access_token, 'X-PrettyPrint': '1' };
          console.log('Not using gzip compression\n');
        }
        
        for(let record of records) {
          
          if(!doDownloading) {
            console.warning('Operation cancelled by user');
            return; //stop if operation cancelled
          }

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
            filename = path.join(folder, `${dates.slice(11, 13)}-${types}.csv`);
            if (!fs.existsSync(folder))           
              fs.mkdirSync(folder, { recursive : true });
          }
          downloadFile(url, headers, filename);
          mainWindow.webContents.send('filedownloadupdate');
          
        };
      }
    } else {
      dialog.showMessageBox('INFO ', 'No records found');
    }
  
  } catch(error){
    console.error(`Error: ${error}`);
    dialog.showErrorBox('Error', error.message);    
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

async function savesettingfile(data) {
  fs.writeFile('app/settings.json', data, (err) => {
    if (err) { console.error(`settings.json update failed: ${err}`); }
    else console.log('settings.json updated');
  });
}

async function readsettingfile() {
  try{
    const data = await fsPromise.readFile('app/settings.json');     
    const jsonData = JSON.parse(data);
    return jsonData;    
  } catch(err) {
    console.error(`Error: ${err}`); 
  }
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
    writer.on('finish', resolve);
    writer.on('error', reject);

  });
}

async function salesforcelogin(username, password, baseurl) {

	const loginUrl = `https://${baseurl || 'login.salesforce.com'}/services/Soap/u/${API_VERSION}`;

	const soapRequest = `
  <?xml version="1.0" encoding="utf-8" ?>
  <env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
    <env:Body>
      <n1:login xmlns:n1="urn:partner.soap.sforce.com">
        <n1:username><![CDATA[${username}]]></n1:username>
        <n1:password><![CDATA[${password}]]></n1:password>
      </n1:login>
    </env:Body>
  </env:Envelope>
`;

const response = await axios.post(loginUrl, soapRequest, {
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      'SOAPAction': 'login',
      'Accept': 'text/xml'
    }
});
// Convert the XML response to a JavaScript object
const parsed = await xml2js.parseStringPromise(response.data)//, (err, response) => {
//.then(function (result) {
    console.dir(parsed);
    const result = parsed["soapenv:Envelope"]["soapenv:Body"].loginResponse.result;
    //const accessToken = result['soapenv:Envelope']['soapenv:Body'][0]['loginResponse'][0]['result'][0]['sessionId'][0];
    console.log('Access token:', accessToken);
//});
}
